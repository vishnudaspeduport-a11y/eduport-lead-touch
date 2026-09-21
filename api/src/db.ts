import postgres, { type Sql } from 'postgres';
import type { Env } from './env';

/**
 * One short-lived client per request. Connection string comes from the
 * Hyperdrive binding when configured, otherwise from the DATABASE_URL secret
 * (Supabase transaction pooler, port 6543, works directly from Workers).
 */
export function getSql(env: Env): Sql {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new Error('No database configured: set the DATABASE_URL secret or a Hyperdrive binding');
  return postgres(url, {
    max: 5,
    fetch_types: false,          // skip the type round-trip; we cast in SQL (::int / ::float8 / ::text)
    prepare: false,              // required for transaction pooling (Supavisor / Hyperdrive)
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
  });
}

export function release(sql: Sql, ctx: { waitUntil(p: Promise<unknown>): void }): void {
  ctx.waitUntil(sql.end({ timeout: 5 }).catch(() => undefined));
}
