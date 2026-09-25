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

/** Hyperdrive occasionally hands out a connection that the database has already closed (right after a deploy,
 *  a VACUUM FULL or a heavy load). The first statement then fails with CONNECTION_CLOSED / ECONNRESET. */
export function isDroppedConnection(e: unknown): boolean {
  const m = e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ''}` : String(e);
  return /CONNECTION_CLOSED|ECONNRESET|Network connection lost|terminating connection|connection is closed/i.test(m);
}

/** Run `work` with a client; if the connection turns out dead, retry ONCE on a fresh client. */
export async function withSql<T>(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, work: (sql: Sql) => Promise<T>): Promise<T> {
  let sql = getSql(env);
  try {
    return await work(sql);
  } catch (e) {
    if (!isDroppedConnection(e)) throw e;
    release(sql, ctx);
    sql = getSql(env);
    return await work(sql);
  } finally {
    release(sql, ctx);
  }
}

export function release(sql: Sql, ctx: { waitUntil(p: Promise<unknown>): void }): void {
  ctx.waitUntil(sql.end({ timeout: 5 }).catch(() => undefined));
}
