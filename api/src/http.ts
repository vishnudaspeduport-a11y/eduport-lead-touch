import type { Context } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from './env';
import { getSql, release } from './db';
import { parseFilters, resolvePeriods, type Filters, type Periods } from './filters';

export interface Ctx { sql: Sql; f: Filters; periods: Periods; q: Record<string, string>; role: Role; }

/** Parse filters, open a DB client, run `fn`, JSON-envelope the result. */
export async function handle<T>(c: Context<AppEnv>, fn: (x: Ctx) => Promise<T>, cache = 60): Promise<Response> {
  const q = c.req.query();
  const f = parseFilters(q);
  const periods = resolvePeriods(f);
  const sql = getSql(c.env);
  const t0 = Date.now();
  try {
    const data = await fn({ sql, f, periods, q, role: c.get('user').role });
    return c.json(
      { data, meta: { period: periods.current, previous: periods.previous, basis: f.basis, tookMs: Date.now() - t0 } },
      200,
      { 'Cache-Control': `private, max-age=${cache}` },
    );
  } finally {
    release(sql, c.executionCtx);
  }
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
  if (role === 'admin') return v;
  const d = v.replace(/\D/g, '');
  return d.length >= 4 ? `${'•'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : '••••';
}
export function maskEmail(v: string | null | undefined, role: Role): string | null {
  if (v == null) return null;
  if (role === 'admin') return v;
  const [u, dom] = v.split('@');
  return dom ? `${(u ?? '').slice(0, 1)}•••@${dom}` : '•••';
}
export function maskName(v: string | null | undefined, role: Role): string | null {
  if (v == null) return null;
  if (role === 'admin') return v;
  return v.split(/\s+/).map((p) => (p.length ? `${p[0]}${'•'.repeat(Math.min(6, Math.max(1, p.length - 1)))}` : p)).join(' ');
}
