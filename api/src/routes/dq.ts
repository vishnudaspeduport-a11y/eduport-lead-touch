import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, intParam, maskPhone } from '../http';

export const dq = new Hono<AppEnv>();

/** check key -> view (allowlist; never from user input) */
const CHECKS: Record<string, { view: string; order: string; pii?: string[] }> = {
  leads_no_touches:        { view: 'dq_leads_no_touches',        order: 'created_date DESC' },
  orphan_touches:          { view: 'dq_orphan_touches',          order: 'touch_at DESC' },
  bad_lead_phones:         { view: 'dq_bad_lead_phones',         order: 'created_date DESC', pii: ['raw_phone', 'phone_key'] },
  bad_user_phones:         { view: 'dq_bad_user_phones',         order: 'valid_payments DESC', pii: ['raw_phone', 'phone_key'] },
  payments_no_lead:        { view: 'dq_payments_no_lead',        order: 'payment_date DESC', pii: ['phone_key'] },
  flagged_duplicates:      { view: 'dq_flagged_duplicates',      order: 'created_date DESC', pii: ['phone_key'] },
  phone_collisions:        { view: 'dq_phone_collisions',        order: 'leads DESC', pii: ['phone_key'] },
  touch_count_mismatch:    { view: 'dq_touch_count_mismatch',    order: 'abs(diff) DESC' },
  paid_before_first_touch: { view: 'dq_paid_before_first_touch', order: 'days_payment_before_touch DESC' },
  paid_before_created:     { view: 'dq_paid_before_created',     order: 'days_payment_before_lead DESC' },
  sf_converted_mismatch:   { view: 'dq_sf_converted_mismatch',   order: 'created_date DESC' },
  blank_touch_attrs:       { view: 'dq_blank_touch_attrs',       order: 'touch_at DESC' },
  unmapped_class:          { view: 'dq_unmapped_class',          order: 'leads DESC' },
};

/** GET /api/data-quality : counts for every check (global - not filtered, this is about the whole dataset) */
dq.get('/data-quality', (c) =>
  handle(c, async ({ sql }) => {
    const exists = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_views WHERE schemaname = 'analytics' AND viewname = 'v_dq_summary'`;
    if (!exists[0].n) return { checks: [], note: 'Data-quality checks are switched off while the analytics views are being redesigned.' };
    const rows = await sql<{ check_key: string; label: string; bad_rows: number; total_rows: number }[]>`
      SELECT check_key, label, bad_rows::int, total_rows::int FROM analytics.v_dq_summary`;
    return {
      checks: rows.map((r) => ({ ...r, pct: r.total_rows ? Math.round((r.bad_rows / r.total_rows) * 10000) / 100 : null })),
      note: 'Counts cover the entire replicated dataset (all time), independent of the global filters.',
    };
  }, 300),
);

/** GET /api/data-quality/:check?page=1&limit=50 */
dq.get('/data-quality/:check', (c) =>
  handle(c, async ({ sql, q, role }) => {
    const key = c.req.param('check');
    const spec = CHECKS[key];
    if (!spec) throw Object.assign(new Error('unknown check'), { status: 404 });
    const limit = intParam(q, 'limit', 50, 1, 200);
    const page = intParam(q, 'page', 1, 1, 100000);
    const view = sql(`analytics.${spec.view}`);
    const [rows, [tot]] = await Promise.all([
      sql<Record<string, unknown>[]>`SELECT * FROM ${view} ORDER BY ${sql.unsafe(spec.order)} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${view}`,
    ]);
    const out = rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        o[k] = spec.pii?.includes(k) ? maskPhone(v as string | null, role) : v instanceof Date ? v.toISOString() : v;
      }
      return o;
    });
    return { check: key, page, limit, total: tot.n, rows: out };
  }, 120),
);
