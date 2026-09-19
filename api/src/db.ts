import postgres, { type Sql } from 'postgres';
import type { Env } from './env';

/**
 * One short-lived client per request (Workers best practice with Hyperdrive:
 * Hyperdrive keeps the real pool warm at the edge). Call `release(sql, ctx)`
 * when done so the connection returns to Hyperdrive.
 */
export function getSql(env: Env): Sql {
  return postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,          // skip the type round-trip; we cast in SQL (::int / ::float8 / ::text)
    prepare: false,              // Hyperdrive is transaction-pooled
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
  });
}

export function release(sql: Sql, ctx: { waitUntil(p: Promise<unknown>): void }): void {
  ctx.waitUntil(sql.end({ timeout: 5 }).catch(() => undefined));
}
