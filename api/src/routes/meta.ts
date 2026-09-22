import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle } from '../http';
import { LEAD_DIMS, TOUCH_DIMS } from '../filters';
import { DEFINITIONS } from '../definitions';

export const meta = new Hono<AppEnv>();

meta.get('/meta', (c) =>
  handle(c, async ({ sql }) => {
    const [asOf] = await sql<{
      refreshed_at: string | null; salesforce_as_of: string | null; last_sync_run_at: string | null;
      lead_master_synced_at: string | null; lead_rows: number; touch_rows: number;
    }[]>`
      SELECT refreshed_at::text, salesforce_as_of::text, last_sync_run_at::text, lead_master_synced_at::text,
             lead_rows::int, touch_rows::int
      FROM analytics.v_data_as_of`;
    const syncState = await sql<{ object_name: string; last_modstamp: string | null; last_run_at: string | null; last_run_rows: number | null; last_error: string | null }[]>`
      SELECT object_name, last_modstamp::text, last_run_at::text, last_run_rows, last_error FROM salesforce._sync_state ORDER BY 1`;
    const lastRefresh = await sql<{ view_name: string; finished_at: string | null; ok: boolean | null; row_count: number | null; error: string | null }[]>`
      SELECT DISTINCT ON (view_name) view_name, finished_at::text, ok, row_count::int, error
      FROM analytics.refresh_log ORDER BY view_name, started_at DESC`;
    // refresh_one logs regclass::text, which drops the schema when analytics is on the search_path
    if (!asOf.refreshed_at) asOf.refreshed_at = lastRefresh.find((r) => r.ok && r.view_name.includes('mv_'))?.finished_at ?? asOf.last_sync_run_at;
    const user = c.get('user');
    return {
      user,
      version: c.env.APP_VERSION ?? 'dev',
      dataAsOf: asOf,
      syncState,
      lastRefresh,
      dims: {
        lead: Object.fromEntries(Object.entries(LEAD_DIMS).map(([k, v]) => [k, v.label])),
        touch: Object.fromEntries(Object.entries(TOUCH_DIMS).map(([k, v]) => [k, v.label])),
      },
      definitions: DEFINITIONS,
    };
  }, 30),
);

meta.get('/definitions', (c) => c.json({ data: DEFINITIONS }));
