import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppEnv, Env, Role, User } from './env';
import { getSql, release } from './db';

/**
 * Auth = Supabase Auth (email login in the web app). The browser sends the
 * Supabase access token as `Authorization: Bearer <jwt>`; the Worker verifies
 * it against the project's JWKS (new projects, ES256) or the legacy HS256
 * secret (SUPABASE_JWT_SECRET) and then decides the role:
 *   admin  - email in ADMIN_EMAILS, or public.app_users.role = 'admin'
 *   viewer - email domain matches ALLOWED_EMAIL_DOMAIN, or a public.app_users row exists
 *   403    - anyone else ("Access pending" in the UI)
 *
 * AUTH_MODE=dev (local only) trusts DEV_USER_EMAIL.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwks(supabaseUrl: string) {
  let j = jwksCache.get(supabaseUrl);
  if (!j) { j = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)); jwksCache.set(supabaseUrl, j); }
  return j;
}

const adminList = (env: Env) => (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function resolveRole(env: Env, email: string, userId: string | null, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Role | null> {
  const e = email.toLowerCase();
  if (adminList(env).includes(e)) return 'admin';
  // optional allow-list table (public.app_users) for people outside the domain / extra admins
  const sql = getSql(env);
  try {
    const rows = await sql<{ role: string }[]>`
      SELECT role FROM public.app_users WHERE (user_id::text = ${userId ?? ''} OR lower(email) = ${e}) AND role IN ('admin','viewer') LIMIT 1`.catch(() => []);
    if (rows[0]?.role === 'admin') return 'admin';
    if (rows[0]?.role === 'viewer') return 'viewer';
  } finally {
    release(sql, ctx);
  }
  const domain = env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (domain && e.endsWith(`@${domain}`)) return 'viewer';
  return null;
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const env = c.env;
  let email: string | undefined;
  let userId: string | null = null;

  if (env.AUTH_MODE === 'none') {
    // No login: everyone is the public user. PII stays masked unless PUBLIC_ROLE=admin.
    c.set('user', { email: 'public', role: env.PUBLIC_ROLE === 'admin' ? 'admin' : 'viewer' });
    await next();
    return;
  }
  if (env.AUTH_MODE === 'dev') {
    email = env.DEV_USER_EMAIL ?? 'dev@localhost';
  } else {
    const h = c.req.header('Authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
    try {
      const issuer = `${env.SUPABASE_URL}/auth/v1`;
      const opts = { issuer, audience: 'authenticated' as const };
      const { payload } = env.SUPABASE_JWT_SECRET
        ? await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), opts)
        : await jwtVerify(token, jwks(env.SUPABASE_URL), opts);
      const p = payload as JWTPayload & { email?: string };
      email = p.email;
      userId = p.sub ?? null;
    } catch (e) {
      return c.json({ error: { code: 'unauthenticated', message: `Invalid or expired session: ${(e as Error).message}` } }, 401);
    }
  }

  if (!email) return c.json({ error: { code: 'unauthenticated', message: 'No email on the session' } }, 401);
  const role = await resolveRole(env, email, userId, c.executionCtx);
  if (!role) return c.json({ error: { code: 'forbidden', message: 'Access pending: ask an admin to approve your email' } }, 403);
  const user: User = { email, role };
  c.set('user', user);
  await next();
});
