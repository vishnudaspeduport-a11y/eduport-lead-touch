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
import { txPooler } from './sync-url.js';

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
const SKIP = (process.env.SKIP_OBJECTS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const wanted = (name: string) => (!ONLY.length || ONLY.includes(name)) && !SKIP.includes(name);

// Supabase: the session pooler (5432) allows only 15 clients on the free plan and Hyperdrive keeps most of
// them; the transaction pooler (6543) allows far more. Rewrite the port and avoid session-level state.
const sql = postgres(txPooler(env('DATABASE_URL')), { max: 2, prepare: false, idle_timeout: 20, transform: { undefined: null }, connection: { application_name: 'lead-touch-sync' } });

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
  const key = spec.key ?? spec.object;
  const since = await getState(key);
  const where: string[] = [];
  if (since) where.push(`SystemModstamp > ${since.toISOString()}`);
  if (spec.initialWhere) where.push(spec.initialWhere);   // window applies always, so old leads modified later never creep in
  const q = `SELECT ${spec.fields.join(', ')} FROM ${spec.object}` + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY SystemModstamp ASC';

  console.log(`[${key}] ${since ? `incremental since ${since.toISOString()}` : `FULL load${spec.initialWhere ? ` (${spec.initialWhere})` : ''}`}`);
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
      if (n && n % 20000 < BATCH) console.log(`[${key}] ${n} rows...`);
    }
    if (buf.length) { await upsert(`salesforce.${spec.table}`, buf); n += buf.length; }
    await setState(key, maxStamp, n, null);
    console.log(`[${key}] done: ${n} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s (watermark ${maxStamp})`);
  } catch (e) {
    await setState(key, null, n, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ---------------------------------------------------------------- production app DB -> app.*
interface AppTableSpec { name: string; select: (src: Sql, since: Date | null) => AsyncIterable<Record<string, unknown>[]>; stampCol: string; }

// Minimal copy (Supabase free tier): only payments that can ever count as valid + the users behind them,
// and only the columns the analytics views read. Validity is still evaluated in analytics.v_valid_payment,
// so a payment that is refunded / deleted later is corrected by the 45-day incremental tail.
const VALID = `p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true`;
const APP_TABLES: AppTableSpec[] = [
  {
    name: 'home_payment', stampCol: 'created',
    select: (src, since) => (since
      ? src`SELECT p.id, p.user_id, p.payment_method, p.payment_type, p.deleted, p.is_success, p.payment_success, p.payment_date, p.payment_time, p.created,
                   p.amount, p.total, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id, p.batch_id, p.sales_person_id, p.enrollment_id
            FROM public.home_payment p
            WHERE p.created > ${since}::timestamptz - interval '45 days' OR p.payment_date >= (${since}::date - 45)
            ORDER BY p.id`.cursor(5000)
      : src.unsafe(`SELECT p.id, p.user_id, p.payment_method, p.payment_type, p.deleted, p.is_success, p.payment_success, p.payment_date, p.payment_time, p.created,
                   p.amount, p.total, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id, p.batch_id, p.sales_person_id, p.enrollment_id
            FROM public.home_payment p WHERE ${VALID} ORDER BY p.id`).cursor(5000)),
  },
  {
    name: 'home_customuser', stampCol: 'updated_at',
    select: (src, since) => (since
      ? src`SELECT u.id, u.phone, u.is_deleted, u.created, u.updated_at
            FROM public.home_customuser u
            WHERE u.id IN (SELECT p.user_id FROM public.home_payment p WHERE p.created > ${since}::timestamptz - interval '45 days')
               OR (u.updated_at > ${since}::timestamptz AND u.id IN (SELECT p.user_id FROM public.home_payment p WHERE p.payment_method = 0))
            ORDER BY u.id`.cursor(5000)
      : src.unsafe(`SELECT u.id, u.phone, u.is_deleted, u.created, u.updated_at
            FROM public.home_customuser u
            WHERE u.id IN (SELECT p.user_id FROM public.home_payment p WHERE ${VALID}) ORDER BY u.id`).cursor(5000)),
  },
  {
    // batch / course lookup (~3.6k rows) so the dashboard can show names instead of ids
    name: 'core_batch', stampCol: 'updated_at',
    select: (src, since) => (since
      ? src`SELECT b.id, b.title, b.course_id, s.title AS course_title, b.course_fee, b.is_premium, b.is_deleted, b.expiry_date, b.updated_at
            FROM public.core_batch b LEFT JOIN public.core_syllabusstructure s ON s.id = b.course_id
            WHERE b.updated_at > ${since}::timestamptz OR s.updated_at > ${since}::timestamptz ORDER BY b.id`.cursor(2000)
      : src`SELECT b.id, b.title, b.course_id, s.title AS course_title, b.course_fee, b.is_premium, b.is_deleted, b.expiry_date, b.updated_at
            FROM public.core_batch b LEFT JOIN public.core_syllabusstructure s ON s.id = b.course_id ORDER BY b.id`.cursor(2000)),
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
          for (let i = 0; i < rows.length; i += BATCH) await upsert(`app.${t.name}`, rows.slice(i, i + BATCH));   // stay under the 65,534-parameter limit
          n += rows.length;
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

// ---------------------------------------------------------------- keep the replica minimal
// queryAll delivers deleted rows (isdeleted = true) so watermarks stay correct; we then purge them,
// together with anything outside the lead window, so storage stays small (Supabase free tier).
async function cleanup(): Promise<void> {
  const leadSince = process.env.LEAD_SINCE?.slice(0, 10) ?? '2025-04-01';
  await sql.begin(async (sql) => {
  await sql`SET LOCAL statement_timeout = 0`;
  const r1 = await sql`DELETE FROM salesforce.lead_master__c l WHERE l.isdeleted OR l.is_deleted__c
    OR (l.createddate < ${leadSince}::date AND NOT EXISTS (SELECT 1 FROM salesforce.lead_touch__c t WHERE t.lead_master__c = l.id AND NOT t.isdeleted))`;
  const r2 = await sql`DELETE FROM salesforce.interested_course__c ic WHERE ic.isdeleted OR NOT EXISTS (SELECT 1 FROM salesforce.lead_master__c l WHERE l.id = ic.lead_master__c)`;
  const r3 = await sql`DELETE FROM salesforce.lead_touch__c WHERE isdeleted`;
  const r4 = await sql`DELETE FROM salesforce.task WHERE isdeleted`;
  console.log(`[cleanup] removed leads=${r1.count} ics=${r2.count} touches=${r3.count} tasks=${r4.count} (window >= ${leadSince}, deleted rows purged)`);
  });
}

// ---------------------------------------------------------------- refresh
async function refreshViews(): Promise<void> {
  console.log('[refresh] analytics.refresh_all()');
  const t0 = Date.now();
  // Supabase applies a per-role statement timeout; the refresh can legitimately take minutes.
  // Web sessions that died mid-transaction keep locks on the views; they are never legitimately older than a few minutes.
  const stale = await sql<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
    AND application_name = 'postgres.js' AND xact_start < now() - interval '5 minutes'`;   // still useful: stuck web transactions
  for (const { pid } of stale) await sql`SELECT pg_terminate_backend(${pid})`;
  if (stale.length) console.log(`[refresh] terminated ${stale.length} stale web session(s) holding old transactions`);
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = 0`;
    await tx`SET LOCAL lock_timeout = '2min'`;
    return tx<{ view_name: string; row_count: number; seconds: number }[]>`SELECT * FROM analytics.refresh_all()`;
  });
  for (const r of rows) console.log(`[refresh] ${r.view_name}: ${r.row_count} rows in ${r.seconds}s`);
  console.log(`[refresh] total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- compaction (free tier: 500 MB hard limit)
// REFRESH CONCURRENTLY and the daily upserts leave dead space that only VACUUM FULL returns. Run it whenever
// the database passes COMPACT_ABOVE_MB (default 420) so usage never creeps up to the quota.
async function compactIfNeeded(): Promise<void> {
  const limit = Number(process.env.COMPACT_ABOVE_MB ?? 420);
  const [{ mb }] = await sql<{ mb: number }[]>`SELECT round(pg_database_size(current_database())/1048576.0)::int AS mb`;
  console.log(`[compact] database size ${mb} MB (threshold ${limit} MB)`);
  if (mb < limit) return;
  for (const t of ['salesforce.lead_master__c', 'salesforce.interested_course__c', 'salesforce.lead_touch__c', 'app.home_payment', 'app.home_customuser']) {
    const t0 = Date.now();
    await sql.unsafe(`VACUUM FULL ANALYZE ${t}`);
    console.log(`[compact] ${t} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  const [{ mb: after }] = await sql<{ mb: number }[]>`SELECT round(pg_database_size(current_database())/1048576.0)::int AS mb`;
  console.log(`[compact] done: ${mb} MB -> ${after} MB`);
}

// ---------------------------------------------------------------- main
async function main(): Promise<void> {
  // role-level statement_timeout (set for the web app's protection) must not cut the bulk load or the refresh
  await sql`SET statement_timeout = 0`;
  await sql`SET default_transaction_read_only = off`;
  if (!REFRESH_ONLY) {
    const specs = OBJECTS.filter((o) => wanted(o.key ?? o.object) || (o.key && wanted(o.object)));
    if (specs.length) {
      const s = await login();
      for (const spec of specs) await syncSalesforceObject(s, spec);
    }
    await syncAppTables();
    await cleanup();
  }
  if (REFRESH_ONLY || REFRESH_AFTER) await refreshViews();
  await compactIfNeeded();
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (e) => { console.error(e); await sql.end({ timeout: 5 }); process.exit(1); });
