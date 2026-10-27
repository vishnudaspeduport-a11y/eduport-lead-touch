import type { Context } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from './env';
import { getSql, release, withSql } from './db';
import { parseFilters, resolvePeriods, type Filters, type Periods } from './filters';
import { cacheGet, cacheKey, cachePut, dataVersion, KV_TTL_VERSIONED, wantsFresh } from './cache';

export interface Ctx { sql: Sql; f: Filters; periods: Periods; q: Record<string, string>; role: Role; }

/**
 * Edge cache policy for a handler:
 *   'version'        keyed on the data version (default): valid until the next sync refresh
 *   { ttl, perUser }  keyed on time instead (for answers that depend on more than the data, e.g. /meta)
 *   false             never cached
 */
// wrangler dev: a token minted once per isolate, so a code reload never reads answers of the previous code and never touches production entries
let devBuild: string | null = null;
const devBuildId = () => (devBuild ??= `dev-${crypto.randomUUID().slice(0, 8)}`);

export type EdgePolicy = 'version' | false | { ttl: number; perUser?: boolean };

/** Parse filters, open a DB client, run `fn`, JSON-envelope the result. Successful GET answers are cached (see cache.ts). */
export async function handle<T>(c: Context<AppEnv>, fn: (x: Ctx) => Promise<T>, cache = 60, edge: EdgePolicy = 'version'): Promise<Response> {
  const q = c.req.query();
  const f = parseFilters(q);
  const periods = resolvePeriods(f);
  const user = c.get('user');
  const headers: Record<string, string> = { 'Cache-Control': `private, max-age=${cache}` };

  let key: string | null = null; let ttl = KV_TTL_VERSIONED;
  // `wrangler dev --remote` inherits the deployed Worker's BUILD_ID, so dev and production would share cache entries (dev would read
  // answers of the live code and write answers of unreleased code). The launch config passes --var CACHE_SCOPE:dev; localhost hosts count too.
  const isDev = c.env.CACHE_SCOPE === 'dev' || /^(localhost|127.0.0.1|[::1])$/.test(new URL(c.req.url).hostname);
  const build = isDev ? devBuildId() : (c.env.BUILD_ID ?? 'nobuild');
  if (edge && c.req.method === 'GET') {
    const mask = user.role === 'viewer' || user.role === 'bde' ? 'masked' : 'full';   // masked roles never read an answer computed for a full one (and vice versa)
    if (edge === 'version') key = await cacheKey({ version: await dataVersion(c.env, c.executionCtx), build, mask, path: c.req.path, query: q });
    else { ttl = edge.ttl; key = await cacheKey({ version: `ttl${edge.ttl}`, build, mask, path: c.req.path, query: q, user: edge.perUser ? String(user.id ?? user.email) : undefined }); }
    if (!wantsFresh(c.req.raw, q)) {
      const hit = await cacheGet(c.env, key);
      if (hit) return new Response(hit.body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8', 'X-LT-Cache': `hit-${hit.layer}` } });
    }
  }

  const json = (body: string, tag: string) => new Response(body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8', 'X-LT-Cache': tag } });
  // single flight: a second identical request while the first is still computing (the warm-up and the first visitor, two users on the
  // same view) waits for that answer instead of running the same fan-out again on the two-core database
  const running = key ? inflight.get(key) : undefined;
  if (running) return json(await running, 'hit-inflight');
  const work = (async () => {
    const t0 = Date.now();
    const data = await withSql(c.env, c.executionCtx, (sql) => fn({ sql, f, periods, q, role: user.role }));
    const body = JSON.stringify({ data, meta: { period: periods.current, previous: periods.previous, basis: f.basis, tookMs: Date.now() - t0, cachedAt: key ? new Date().toISOString() : undefined, build: key ? build : undefined } });
    if (key) cachePut(c.env, c.executionCtx, key, body, ttl);
    return body;
  })();
  if (key) { inflight.set(key, work); work.catch(() => undefined).finally(() => inflight.delete(key)); }
  return json(await work, key ? 'miss' : 'bypass');
}
const inflight = new Map<string, Promise<string>>();

/**
 * Promise.all for a page's query fan-out that records how long each query took. Slow ones (> 3 s) are logged
 * ("slow queries" in the Worker logs); when one fails, every duration is attached to the error as queryTimes so the
 * 500 response names the statement that hit the timeout instead of just "internal error".
 */
export async function timedAll<T extends readonly unknown[] | []>(names: readonly string[], qs: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const t0 = Date.now(); const times: Record<string, number> = {};
  const settled = await Promise.allSettled((qs as readonly unknown[]).map((q, i) => Promise.resolve(q).finally(() => { times[names[i] ?? String(i)] = Date.now() - t0; })));
  // one line per fan-out whenever it was slow (any statement over 2 s): every duration, slowest first, so the Worker log shows where the time went
  if (Object.values(times).some((ms) => ms > 2000)) console.log('slow queries', JSON.stringify(Object.fromEntries(Object.entries(times).sort((x, y) => y[1] - x[1]))));
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) { const e = failed.reason as { queryTimes?: Record<string, number> }; if (e && typeof e === 'object') e.queryTimes = times; throw failed.reason; }
  return settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as unknown as { -readonly [P in keyof T]: Awaited<T[P]> };
}

export function intParam(q: Record<string, string>, key: string, def: number, min: number, max: number): number {
  const n = Number.parseInt(q[key] ?? '', 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function pct(num: number | null | undefined, den: number | null | undefined): number | null {
  if (!den) return null;
  return Math.round(((num ?? 0) / den) * 10000) / 100;
}

// ---------------------------------------------------------------- PII masking
/** BDE accounts never download anything: every *.csv route and the export password check refuse them (index.ts), the UI hides the buttons */
export const canDownload = (role: Role): boolean => role !== 'bde';

export function maskPhone(v: string | null | undefined, role: Role): string | null {
  if (v == null) return null;
  if (role !== 'viewer' && role !== 'bde') return v;   // bde: phone numbers masked everywhere, names and e-mails stay
  const d = v.replace(/\D/g, '');
  return d.length >= 4 ? `${'•'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : '••••';
}
export function maskEmail(v: string | null | undefined, role: Role): string | null {
  if (v == null) return null;
  if (role !== 'viewer') return v;
  const [u, dom] = v.split('@');
  return dom ? `${(u ?? '').slice(0, 1)}•••@${dom}` : '•••';
}
export function maskName(v: string | null | undefined, role: Role): string | null {
  if (v == null) return null;
  if (role !== 'viewer') return v;
  return v.split(/\s+/).map((p) => (p.length ? `${p[0]}${'•'.repeat(Math.min(6, Math.max(1, p.length - 1)))}` : p)).join(' ');
}

// ---------------------------------------------------------------- CSV export, streamed in pages
/**
 * Streams a CSV while fetching the rows in pages of `pageSize` through `fetchPage(sql, limit, offset)`. One statement per
 * page keeps every query far below the 90 s statement timeout of the pooled connection (one statement for the whole
 * export timed out on the throttled database and produced an empty file). The header row is sent first, so the
 * browser sees the download start immediately. Rows beyond `cap` are dropped and noted in a trailing comment line.
 */
export function csvStream<R extends Record<string, unknown>>(c: Context<AppEnv>, o: {
  cols: readonly string[]; cap: number; filename: string; mask: (r: R) => Record<string, unknown>;
  fetchPage: (sql: Sql, limit: number, offset: number) => Promise<R[]>; pageSize?: number;
}): Response {
  const sql = getSql(c.env);
  const enc = new TextEncoder();
  const size = Math.max(50, o.pageSize ?? 500);
  const esc = (v: unknown) => { if (v == null) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(o.cols.join(',') + '\n'));
        let n = 0; let offset = 0;
        while (n < o.cap) {
          const limit = Math.min(size, o.cap - n);
          const rows = await o.fetchPage(sql, limit, offset);
          let chunk = '';
          for (const r of rows) { const m = o.mask(r); chunk += o.cols.map((k) => esc(m[k])).join(',') + '\n'; }
          if (chunk) controller.enqueue(enc.encode(chunk));
          n += rows.length; offset += rows.length;
          if (rows.length < limit) break;
        }
        if (n >= o.cap) controller.enqueue(enc.encode(`# truncated at ${o.cap} rows\n`));
        controller.close();
      } catch (e) { controller.error(e); } finally { release(sql, c.executionCtx); }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${o.filename}"`, 'cache-control': 'private, no-store' } });
}
