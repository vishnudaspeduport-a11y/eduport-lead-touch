import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppEnv, Env, User } from './env';

/**
 * Auth = Cloudflare Access in front of the Worker (email-based login, SSO or
 * one-time PIN). Access injects a signed JWT (`Cf-Access-Jwt-Assertion`) that we
 * verify against the team's JWKS - so the API cannot be reached by bypassing the
 * Access proxy. Role: email in ADMIN_EMAILS -> admin (unmasked PII), else viewer.
 *
 * AUTH_MODE=dev (local only) trusts DEV_USER_EMAIL.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwks(teamDomain: string) {
  let j = jwksCache.get(teamDomain);
  if (!j) { j = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`)); jwksCache.set(teamDomain, j); }
  return j;
}

export function roleFor(env: Env, email: string): User['role'] {
  const admins = (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase()) ? 'admin' : 'viewer';
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const env = c.env;
  let email: string | undefined;

  if (env.AUTH_MODE === 'dev') {
    email = env.DEV_USER_EMAIL ?? 'dev@localhost';
  } else {
    const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
    if (!token) return c.json({ error: { code: 'unauthenticated', message: 'Missing Cloudflare Access token' } }, 401);
    try {
      const { payload } = await jwtVerify(token, jwks(env.ACCESS_TEAM_DOMAIN), {
        issuer: env.ACCESS_TEAM_DOMAIN,
        audience: env.ACCESS_AUD,
      });
      email = (payload as JWTPayload & { email?: string }).email;
    } catch (e) {
      return c.json({ error: { code: 'unauthenticated', message: `Invalid Access token: ${(e as Error).message}` } }, 401);
    }
  }

  if (!email) return c.json({ error: { code: 'unauthenticated', message: 'No email in token' } }, 401);
  const domain = env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (domain && !email.toLowerCase().endsWith(`@${domain}`)) {
    return c.json({ error: { code: 'forbidden', message: 'Email domain not allowed' } }, 403);
  }
  c.set('user', { email, role: roleFor(env, email) });
  await next();
});
