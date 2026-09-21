import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv, Env } from './env';
import { authMiddleware } from './auth';
import { getSql } from './db';
import { meta } from './routes/meta';
import { filters } from './routes/filters';
import { kpis } from './routes/kpis';
import { trend } from './routes/trend';
import { breakdown } from './routes/breakdown';
import { attribution } from './routes/attribution';
import { touch } from './routes/touch';
import { funnel } from './routes/funnel';
import { cohorts } from './routes/cohorts';
import { team } from './routes/team';
import { leads } from './routes/leads';
import { dq } from './routes/dq';
import { movers } from './routes/movers';
import { syncRoute } from './routes/sync';

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ ok: true, version: c.env.APP_VERSION ?? 'dev' }));

app.use('/api/*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  await next();
});
app.use('/api/*', authMiddleware);

const api = new Hono<AppEnv>();
for (const r of [meta, filters, kpis, trend, breakdown, attribution, touch, funnel, cohorts, team, leads, dq, movers, syncRoute]) api.route('/', r);

// Admin-only manual refresh (the Cron Trigger calls the same function)
api.post('/admin/refresh', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: { code: 'forbidden', message: 'admin only' } }, 403);
  const out = await refreshViews(c.env);
  return c.json({ data: out });
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

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      refreshViews(env)
        .then((rows) => console.log('refresh_all', JSON.stringify(rows)))
        .catch((e) => console.error('refresh_all failed', e)),
    );
  },
} satisfies ExportedHandler<Env>;
