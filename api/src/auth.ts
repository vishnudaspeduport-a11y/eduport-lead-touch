import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Sql } from 'postgres';
import type { AppEnv, Env, User } from './env';
import { getSql, release, withSql } from './db';
import { newToken, sha256Hex } from './password';

/**
 * AUTH_MODE=password: the browser holds an HttpOnly session cookie; the Worker looks the token up in
 * app_auth.sessions (stored hashed) and loads the account. Accounts: role 'admin' -> Role admin,
 * role 'user' -> Role analyst (full lead details, no admin menu). Public endpoints: /api/auth/status,
 * /api/auth/login, /api/auth/setup (first admin only), /api/health.
 *
 * AUTH_MODE=none: no login, everyone is PUBLIC_ROLE (kept for local experiments).
 */
export const COOKIE = 'lt_session';
export const SESSION_DAYS = 30;

export interface Account { id: number; email: string; name: string; role: 'admin' | 'user'; is_active: boolean }

const toUser = (a: Account): User => ({ id: a.id, email: a.email, name: a.name, role: a.role === 'admin' ? 'admin' : 'analyst' });

// tiny per-isolate cache so a page load (10+ parallel API calls) does one session lookup, not ten
const cache = new Map<string, { user: User; until: number }>();
const CACHE_MS = 60_000;
export function forgetSession(tokenHash: string) { cache.delete(tokenHash); }
export function forgetAll() { cache.clear(); }

export async function loadSession(sql: Sql, tokenHash: string): Promise<User | null> {
  const rows = await sql<(Account & { expires_at: string; last_seen_at: string; sid: number })[]>`
    SELECT u.id::int AS id, u.email, u.name, u.role, u.is_active, s.expires_at::text, s.last_seen_at::text, s.id AS sid
    FROM app_auth.sessions s JOIN app_auth.users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()`;
  const r = rows[0];
  if (!r || !r.is_active) return null;
  // sliding expiry: touch at most once an hour
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) {
    await sql`UPDATE app_auth.sessions SET last_seen_at = now(), expires_at = now() + ${SESSION_DAYS + ' days'}::interval WHERE id = ${r.sid}`.catch(() => undefined);
  }
  return toUser(r);
}

export function cookieOpts(c: Context<AppEnv>) {
  const secure = new URL(c.req.url).protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(new URL(c.req.url).hostname);
  return { httpOnly: true, secure, sameSite: 'Lax' as const, path: '/', maxAge: SESSION_DAYS * 86400 };
}

/** Create a session row and set the cookie. */
export async function startSession(c: Context<AppEnv>, sql: Sql, userId: number): Promise<void> {
  const token = newToken();
  const hash = await sha256Hex(token);
  await sql`INSERT INTO app_auth.sessions (user_id, token_hash, expires_at, user_agent, ip)
            VALUES (${userId}, ${hash}, now() + ${SESSION_DAYS + ' days'}::interval, ${(c.req.header('user-agent') ?? '').slice(0, 300)}, ${c.req.header('cf-connecting-ip') ?? null})`;
  // opportunistic cleanup of expired sessions
  c.executionCtx.waitUntil(sql`DELETE FROM app_auth.sessions WHERE expires_at < now() - interval '7 days'`.then(() => undefined).catch(() => undefined));
  setCookie(c, COOKIE, token, cookieOpts(c));
}

export async function endSession(c: Context<AppEnv>, sql: Sql): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) {
    const hash = await sha256Hex(token);
    await sql`DELETE FROM app_auth.sessions WHERE token_hash = ${hash}`.catch(() => undefined);
    forgetSession(hash);
  }
  deleteCookie(c, COOKIE, { path: '/' });
}

/** Requests the Worker makes to itself (cache warm-up from the cron) carry this per-isolate token; it never leaves the isolate. */
let internalToken: string | null = null;   // created lazily: random values are not allowed at module scope on Workers
export const INTERNAL_TOKEN = () => (internalToken ??= crypto.randomUUID());
export const INTERNAL_HEADER = 'x-lt-internal';

const PUBLIC = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/setup', '/api/health']);

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const env: Env = c.env;
  if (env.AUTH_MODE === 'none') {
    c.set('user', { email: 'public', role: env.PUBLIC_ROLE === 'admin' ? 'admin' : env.PUBLIC_ROLE === 'analyst' ? 'analyst' : 'viewer' });
    await next();
    return;
  }
  // same-site guard for state-changing calls (the cookie is SameSite=Lax as well)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const site = c.req.header('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return c.json({ error: { code: 'forbidden', message: 'cross-site request blocked' } }, 403);
  }
  if (PUBLIC.has(new URL(c.req.url).pathname)) { await next(); return; }
  if (c.req.header(INTERNAL_HEADER) === INTERNAL_TOKEN()) { c.set('user', { email: 'warm-up', role: 'analyst' }); await next(); return; }

  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
  const hash = await sha256Hex(token);
  const hit = cache.get(hash);
  let user: User | null = hit && hit.until > Date.now() ? hit.user : null;
  if (!user) {
    user = await withSql(env, c.executionCtx, (sql) => loadSession(sql, hash));
    if (!user) { deleteCookie(c, COOKIE, { path: '/' }); return c.json({ error: { code: 'unauthenticated', message: 'Session expired: sign in again' } }, 401); }
    cache.set(hash, { user, until: Date.now() + CACHE_MS });
  }
  c.set('user', user);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user')?.role !== 'admin') return c.json({ error: { code: 'forbidden', message: 'admin only' } }, 403);
  await next();
});
