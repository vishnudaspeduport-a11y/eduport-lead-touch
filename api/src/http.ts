import type { Context } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from './env';
import { withSql } from './db';
import { parseFilters, resolvePeriods, type Filters, type Periods } from './filters';
import { cacheGet, cacheKey, cachePut, dataVersion, KV_TTL_VERSIONED, wantsFresh } from './cache';

export interface Ctx { sql: Sql; f: Filters; periods: Periods; q: Record<string, string>; role: Role; }

/**
 * Edge cache policy for a handler:
 *   'version'        keyed on the data version (default): valid until the next sync refresh
 *   { ttl, perUser }  keyed on time instead (for answers that depend on more than the data, e.g. /meta)
 *   false             never cached
 */
export type EdgePolicy = 'version' | false | { ttl: number; perUser?: boolean };

/** Parse filters, open a DB client, run `fn`, JSON-envelope the result. Successful GET answers are cached (see cache.ts). */
export async function handle<T>(c: Context<AppEnv>, fn: (x: Ctx) => Promise<T>, cache = 60, edge: EdgePolicy = 'version'): Promise<Response> {
  const q = c.req.query();
  const f = parseFilters(q);
  const periods = resolvePeriods(f);
  const user = c.get('user');
  const headers: Record<string, string> = { 'Cache-Control': `private, max-age=${cache}` };

  let key: string | null = null; let ttl = KV_TTL_VERSIONED;
  if (edge && c.req.method === 'GET') {
    const mask = user.role === 'viewer' ? 'viewer' : 'full';
    if (edge === 'version') key = await cacheKey({ version: await dataVersion(c.env, c.executionCtx), mask, path: c.req.path, query: q });
    else { ttl = edge.ttl; key = await cacheKey({ version: `ttl${edge.ttl}`, mask, path: c.req.path, query: q, user: edge.perUser ? String(user.id ?? user.email) : undefined }); }
    if (!wantsFresh(c.req.raw, q)) {
      const hit = await cacheGet(c.env, key);
      if (hit) return new Response(hit.body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8', 'X-LT-Cache': `hit-${hit.layer}` } });
    }
  }

  const t0 = Date.now();
  const data = await withSql(c.env, c.executionCtx, (sql) => fn({ sql, f, periods, q, role: user.role }));
  const body = JSON.stringify({ data, meta: { period: periods.current, previous: periods.previous, basis: f.basis, tookMs: Date.now() - t0, cachedAt: key ? new Date().toISOString() : undefined } });
  if (key) cachePut(c.env, c.executionCtx, key, body, ttl);
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8', 'X-LT-Cache': key ? 'miss' : 'bypass' } });
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
export function maskPhone(v: string | null | undefined, role: Role): string | null {
  if (v == null) return null;
  if (role !== 'viewer') return v;
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
