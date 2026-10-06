import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv, Env } from './env';
import { authMiddleware, INTERNAL_HEADER, INTERNAL_TOKEN } from './auth';
import { forgetVersion, memStats } from './cache';
import { getSql } from './db';
import { meta } from './routes/meta';
import { filters } from './routes/filters';
import { leads } from './routes/leads';
import { syncRoute } from './routes/sync';
import { overview } from './routes/overview';
import { overviewLeads } from './routes/overview_leads';
import { newLeads } from './routes/new_leads';
import { touchAttribution } from './routes/touch_attribution';
import { converted } from './routes/converted';
import { analysis } from './routes/analysis';
import { authRoutes } from './routes/auth_routes';
import { exportRoutes, requireExportPassword } from './routes/export_auth';

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ ok: true, version: c.env.APP_VERSION ?? 'dev' }));

app.use('/api/*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  await next();
});
app.use('/api/*', authMiddleware);

const api = new Hono<AppEnv>();
// every streamed CSV asks for the shared export password (routes/export_auth.ts)
for (const csv of ['/leads/export.csv', '/converted/users.csv', '/overview/new_leads.csv', '/overview/leads.csv']) api.use(csv, requireExportPassword);
for (const r of [authRoutes, exportRoutes, meta, filters, leads, syncRoute, overview, overviewLeads, newLeads, touchAttribution, converted, analysis]) api.route('/', r);

// Admin-only manual refresh (the Cron Trigger calls the same function)
api.post('/admin/refresh', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: { code: 'forbidden', message: 'admin only' } }, 403);
  const out = await refreshViews(c.env);
  forgetVersion();
  return c.json({ data: out });
});

// Admin: cache warm-up on demand (the cron does the same every 20 minutes) + a peek at the memory layer
api.post('/admin/warm', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: { code: 'forbidden', message: 'admin only' } }, 403);
  const out = await warmCache(c.env, c.executionCtx);
  return c.json({ data: { warmed: out, memory: memStats() } });
});

app.route('/api', api);

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: { code: 'not_found', message: 'no such endpoint' } }, 404) : c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: { code: 'bad_request', message: 'invalid filters', issues: err.issues } }, 400);
  }
  if (err instanceof Error && err.message.startsWith('No database configured')) {
    return c.json({ error: { code: 'not_configured', message: 'Database not connected yet: run `npx wrangler secret put DATABASE_URL` in the api folder.' } }, 503);
  }
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) return c.json({ error: { code: 'bad_request', message: err.message } }, status as 400);
  console.error('unhandled', err);
  return c.json({ error: { code: 'internal', message: 'internal error', detail: err instanceof Error ? err.message : String(err) } }, 500);
});

async function refreshViews(env: Env) {
  const sql = getSql(env);
  try {
    // lt_app_ro has default_transaction_read_only=on and a 20s statement_timeout;
    // both are session-settable, so override them for this transaction only.
    return await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ WRITE`;
      await tx`SET LOCAL statement_timeout = '25min'`;
      return tx<{ view_name: string; row_count: number; seconds: number }[]>`SELECT * FROM analytics.refresh_all()`;
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- cache warm-up
// The default view of every page (last 30 days IST, both bases, the quick-picker lists) is requested through the
// Worker itself so the answers sit in the cache before the first visitor arrives. Sequential on purpose: the
// database is the bottleneck, and when the data version has not changed every request is a cache hit anyway.
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function warmUrls(): string[] {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  const to = ymd(nowIst); const from = ymd(new Date(nowIst.getTime() - 29 * 86400 * 1000));
  const base = (basis: 'created' | 'touch') => `from=${from}&to=${to}&basis=${basis}&compare=none`;
  const urls = [
    `/api/overview?${base('created')}&stale_days=5`,
    `/api/converted?${base('created')}&pm=all`,
    `/api/touch-attribution?${base('created')}`,
    ...['class_group', 'touch_point', 'source', 'campaign', 'medium'].map((dim) => `/api/filters?${base('created')}&dim=${dim}&limit=5000`),
    `/api/overview?${base('touch')}&stale_days=5`,
    `/api/converted?${base('touch')}&pm=all`,
  ];
  return urls;
}

type FetchCtx = Parameters<typeof app.fetch>[2];
export async function warmCache(env: Env, ctx: FetchCtx): Promise<{ url: string; status: number; cache: string; ms: number }[]> {
  const out: { url: string; status: number; cache: string; ms: number }[] = [];
  for (const url of warmUrls()) {
    const t0 = Date.now();
    try {
      const res = await app.fetch(new Request(`https://warm.internal${url}`, { headers: { [INTERNAL_HEADER]: INTERNAL_TOKEN(), accept: 'application/json' } }), env, ctx);
      await res.arrayBuffer();   // drain so the body is not kept open
      out.push({ url, status: res.status, cache: res.headers.get('X-LT-Cache') ?? '-', ms: Date.now() - t0 });
    } catch (e) {
      out.push({ url, status: 0, cache: e instanceof Error ? e.message.slice(0, 120) : String(e), ms: Date.now() - t0 });
    }
  }
  return out;
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      warmCache(env, ctx)
        .then((rows) => console.log('warm', JSON.stringify(rows)))
        .catch((e) => console.error('warm failed', e)),
    );
  },
} satisfies ExportedHandler<Env>;
