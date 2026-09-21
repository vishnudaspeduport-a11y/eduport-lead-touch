/**
 * Replication into the analytics Postgres (Supabase):
 *   1. Salesforce objects  -> salesforce.*   (REST queryAll, SystemModstamp watermarks)
 *   2. Production app DB   -> app.*          (home_customuser, home_payment; id / updated watermarks)
 *   3. analytics.refresh_all()               (materialized views)
 *
 * Usage:
 *   npm run sync            # incremental
 *   npm run sync:full       # ignore watermarks, reload everything
 *   npm run refresh         # only refresh the analytics materialized views
 *
 * Env (see .env.example):
 *   SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET   Salesforce connected app (client-credentials flow)
 *   SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN   optional fallback: username-password flow
 *   DATABASE_URL            target  = Supabase, role lt_analytics_owner
 *   SOURCE_DATABASE_URL     source  = Eduport production Postgres (read-only user is enough)
 *   LEAD_SINCE              initial Lead_Master__c / Interested_Course__c lower bound (default 2025-04-01)
 *   TASK_SINCE              initial Task lower bound (default 2026-01-01)
 *   SYNC_OBJECTS            optional comma list to restrict (e.g. Lead_Touch__c,home_payment)
 *   REFRESH_AFTER_SYNC=1    run analytics.refresh_all() at the end (default 1)
 *
 * Idempotent (INSERT ... ON CONFLICT DO UPDATE). Run from GitHub Actions every 30 min.
 */
import postgres, { type Sql } from 'postgres';
import { OBJECTS, type ObjectSpec } from './objects.js';

const API_VERSION = 'v62.0';
const BATCH = 1000;

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const args = new Set(process.argv.slice(2));
const FULL = args.has('--full');
const REFRESH_ONLY = args.has('--refresh-only');
const REFRESH_AFTER = (process.env.REFRESH_AFTER_SYNC ?? '1') === '1';
const ONLY = process.env.SYNC_OBJECTS?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
const wanted = (name: string) => !ONLY.length || ONLY.includes(name);

const sql = postgres(env('DATABASE_URL'), { max: 4, idle_timeout: 30, transform: { undefined: null }, connection: { application_name: 'lead-touch-sync' } });

// ---------------------------------------------------------------- watermark helpers
async function getState(name: string): Promise<Date | null> {
  const [s] = await sql<{ last_modstamp: Date | null }[]>`SELECT last_modstamp FROM salesforce._sync_state WHERE object_name = ${name}`;
  return FULL ? null : s?.last_modstamp ?? null;
}
async function setState(name: string, stamp: Date | string | null, rows: number, error: string | null): Promise<void> {
  await sql`
    INSERT INTO salesforce._sync_state (object_name, last_modstamp, last_run_at, last_run_rows, last_error)
    VALUES (${name}, ${stamp}, now(), ${rows}, ${error})
    ON CONFLICT (object_name) DO UPDATE SET
      last_modstamp = COALESCE(EXCLUDED.last_modstamp, salesforce._sync_state.last_modstamp),
      last_run_at = now(), last_run_rows = EXCLUDED.last_run_rows, last_error = EXCLUDED.last_error`;
}

async function upsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const updateCols = cols.filter((c) => c !== 'id');
  await sql`
    INSERT INTO ${sql(table)} ${sql(rows, ...cols)}
    ON CONFLICT (id) DO UPDATE SET
    ${sql.unsafe(updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', '))}
  `;
}

// ---------------------------------------------------------------- Salesforce
interface SfSession { instanceUrl: string; token: string; }

async function login(): Promise<SfSession> {
  // Tries OAuth client-credentials first (Connected App with "Enable Client Credentials Flow" + Run-As user),
  // then the username-password flow when SF_USERNAME is set. Reports both errors if both fail.
  const base = { client_id: env('SF_CLIENT_ID'), client_secret: env('SF_CLIENT_SECRET') };
  const attempts: [string, URLSearchParams][] = [['client-credentials flow', new URLSearchParams({ grant_type: 'client_credentials', ...base })]];
  if (process.env.SF_USERNAME) {
    attempts.push(['username-password flow', new URLSearchParams({ grant_type: 'password', ...base,
      username: env('SF_USERNAME'), password: env('SF_PASSWORD') + (process.env.SF_SECURITY_TOKEN ?? '') })]);
  }
  // Client-credentials MUST hit the org's My Domain (https://xxx.my.salesforce.com); login.salesforce.com answers
  // "request not supported on this domain". Try SF_MY_DOMAIN first, then SF_LOGIN_URL / login.salesforce.com.
  const hosts = [...new Set([process.env.SF_MY_DOMAIN, process.env.SF_LOGIN_URL, 'https://login.salesforce.com']
    .filter((h): h is string => !!h).map((h) => h.replace(/\/+$/, '')))];
  const errors: string[] = [];
  for (const [name, body] of attempts) {
    for (const host of hosts) {
      const res = await fetch(`${host}/services/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (res.ok) {
        console.log(`[salesforce] logged in via ${name} at ${host}`);
        const j = (await res.json()) as { access_token: string; instance_url: string };
        return { instanceUrl: j.instance_url, token: j.access_token };
      }
      errors.push(`${name} @ ${host}: ${res.status} ${await res.text()}`);
    }
  }
  throw new Error(`Salesforce login failed - ${errors.join(' | ')}`);
}

async function* soql(s: SfSession, query: string, all: boolean): AsyncGenerator<Record<string, unknown>[]> {
  let url: string | null = `${s.instanceUrl}/services/data/${API_VERSION}/${all ? 'queryAll' : 'query'}?q=${encodeURIComponent(query)}`;
  while (url) {
    let res = await fetch(url, { headers: { authorization: `Bearer ${s.token}` } });
    if (res.status === 401) { const n = await login(); s.token = n.token; res = await fetch(url, { headers: { authorization: `Bearer ${s.token}` } }); }
    if (!res.ok) throw new Error(`SOQL failed ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { records: Record<string, unknown>[]; done: boolean; nextRecordsUrl?: string };
    yield j.records;
    url = j.done || !j.nextRecordsUrl ? null : `${s.instanceUrl}${j.nextRecordsUrl}`;
  }
}

function getPath(rec: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : null), rec);
}
function toRow(spec: ObjectSpec, rec: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const col = spec.flatten?.[f] ?? f.toLowerCase();
    const v = f.includes('.') ? getPath(rec, f) : rec[f];
    row[col] = v === undefined ? null : v;
  }
  row._synced_at = new Date();
  return row;
}

async function syncSalesforceObject(s: SfSession, spec: ObjectSpec): Promise<void> {
  const since = await getState(spec.object);
  const where: string[] = [];
  if (since) where.push(`SystemModstamp > ${since.toISOString()}`);
  else if (spec.initialWhere) where.push(spec.initialWhere);
  const q = `SELECT ${spec.fields.join(', ')} FROM ${spec.object}` + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY SystemModstamp ASC';

  console.log(`[${spec.object}] ${since ? `incremental since ${since.toISOString()}` : `FULL load${spec.initialWhere ? ` (${spec.initialWhere})` : ''}`}`);
  let n = 0;
  let maxStamp: string | null = since?.toISOString() ?? null;
  const t0 = Date.now();
  try {
    let buf: Record<string, unknown>[] = [];
    for await (const page of soql(s, q, spec.queryAll ?? false)) {
      for (const rec of page) {
        const row = toRow(spec, rec);
        buf.push(row);
        const st = row.systemmodstamp as string | null;
        if (st && (!maxStamp || st > maxStamp)) maxStamp = st;
        if (buf.length >= BATCH) { await upsert(`salesforce.${spec.table}`, buf); n += buf.length; buf = []; }
      }
      if (n && n % 20000 < BATCH) console.log(`[${spec.object}] ${n} rows...`);
    }
    if (buf.length) { await upsert(`salesforce.${spec.table}`, buf); n += buf.length; }
    await setState(spec.object, maxStamp, n, null);
    console.log(`[${spec.object}] done: ${n} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s (watermark ${maxStamp})`);
  } catch (e) {
    await setState(spec.object, null, n, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ---------------------------------------------------------------- production app DB -> app.*
interface AppTableSpec { name: string; select: (src: Sql, since: Date | null) => AsyncIterable<Record<string, unknown>[]>; stampCol: string; }

const APP_TABLES: AppTableSpec[] = [
  {
    name: 'home_customuser', stampCol: 'updated_at',
    select: (src, since) => (since
      ? src`SELECT id, phone, name, is_deleted, is_premium, premium_date, created, last_active, district, city, updated_at
            FROM public.home_customuser WHERE updated_at > ${since} OR created > ${since} ORDER BY id`.cursor(5000)
      : src`SELECT id, phone, name, is_deleted, is_premium, premium_date, created, last_active, district, city, updated_at
            FROM public.home_customuser ORDER BY id`.cursor(5000)),
  },
  {
    name: 'home_payment', stampCol: 'created',
    // payments can flip flags (deleted / payment_success) after creation, so always re-copy a 45-day tail
    select: (src, since) => (since
      ? src`SELECT id, user_id, payment_method, payment_type, deleted, is_success, payment_success, payment_date, payment_time, created,
                   amount, total, tuition_fees, discount, refund_amount, course_id, course_new_id, batch_id, sales_person_id, enrollment_id
            FROM public.home_payment WHERE created > ${since} - interval '45 days' OR payment_date >= (${since}::date - 45) ORDER BY id`.cursor(5000)
      : src`SELECT id, user_id, payment_method, payment_type, deleted, is_success, payment_success, payment_date, payment_time, created,
                   amount, total, tuition_fees, discount, refund_amount, course_id, course_new_id, batch_id, sales_person_id, enrollment_id
            FROM public.home_payment ORDER BY id`.cursor(5000)),
  },
];

async function syncAppTables(): Promise<void> {
  const url = process.env.SOURCE_DATABASE_URL;
  if (!url) { console.log('[app] SOURCE_DATABASE_URL not set - skipping app tables'); return; }
  const src = postgres(url, { max: 2, idle_timeout: 30, connection: { application_name: 'lead-touch-sync-ro' } });
  try {
    for (const t of APP_TABLES) {
      if (!wanted(t.name)) continue;
      const since = await getState(t.name);
      console.log(`[${t.name}] ${since ? `incremental since ${since.toISOString()}` : 'FULL copy'}`);
      let n = 0; let maxStamp: Date | null = since; const t0 = Date.now();
      try {
        for await (const batch of t.select(src, since)) {
          const rows: Record<string, unknown>[] = batch.map((r) => ({ ...(r as Record<string, unknown>), _synced_at: new Date() }));
          for (const r of rows) { const st = r[t.stampCol] as Date | null; if (st && (!maxStamp || st > maxStamp)) maxStamp = st; }
          await upsert(`app.${t.name}`, rows); n += rows.length;
          if (n % 50000 < 5000) console.log(`[${t.name}] ${n} rows...`);
        }
        await setState(t.name, maxStamp ?? new Date(), n, null);
        console.log(`[${t.name}] done: ${n} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (e) {
        await setState(t.name, null, n, e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
  } finally {
    await src.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------- refresh
async function refreshViews(): Promise<void> {
  console.log('[refresh] analytics.refresh_all()');
  const t0 = Date.now();
  // Supabase applies a per-role statement timeout; the refresh can legitimately take minutes.
  await sql`SET statement_timeout = 0`;
  await sql`SET lock_timeout = '2min'`;
  const rows = await sql<{ view_name: string; row_count: number; seconds: number }[]>`SELECT * FROM analytics.refresh_all()`;
  for (const r of rows) console.log(`[refresh] ${r.view_name}: ${r.row_count} rows in ${r.seconds}s`);
  console.log(`[refresh] total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- main
async function main(): Promise<void> {
  // role-level statement_timeout (set for the web app's protection) must not cut the bulk load or the refresh
  await sql`SET statement_timeout = 0`;
  if (!REFRESH_ONLY) {
    const specs = OBJECTS.filter((o) => wanted(o.object));
    if (specs.length) {
      const s = await login();
      for (const spec of specs) await syncSalesforceObject(s, spec);
    }
    await syncAppTables();
  }
  if (REFRESH_ONLY || REFRESH_AFTER) await refreshViews();
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (e) => { console.error(e); await sql.end({ timeout: 5 }); process.exit(1); });
