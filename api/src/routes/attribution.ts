import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, intParam } from '../http';
import { dimExpr, isTouchDim, leadWhere, touchWhere, type TouchDim } from '../filters';

export const attribution = new Hono<AppEnv>();

export interface AttributionRow {
  key: string; touches: number; leads: number;
  first_touch: number; last_touch: number; linear: number; position: number;
  rev_first: number; rev_last: number; rev_linear: number; rev_position: number;
  diff_last_vs_linear: number;   // + = over-credited by last touch
  share_last: number | null; share_linear: number | null;
}

/**
 * GET /api/attribution?dim=touch_point|source|medium|campaign|ad_set|ad_name|staff
 * Credits come from mv_touch_base (pre-conversion touches of converted leads only):
 *   first / last = 1 to that touch, linear = 1/n, position = 40/20/40.
 * "Unattributed" = converted leads with no pre-conversion touch (from mv_lead_base).
 */
attribution.get('/attribution', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const dim = q.dim ?? 'touch_point';
    if (!isTouchDim(dim)) throw Object.assign(new Error(`dim must be a touch dimension`), { status: 400 });
    const limit = intParam(q, 'limit', 50, 1, 500);
    const p = periods.current;
    const expr = dimExpr(sql, dim as TouchDim, 't');

    const [rows, [unattr]] = await Promise.all([
      sql<AttributionRow[]>`
        SELECT ${expr} AS key,
               count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               COALESCE(sum(t.credit_first),0)::float8    AS first_touch,
               COALESCE(sum(t.credit_last),0)::float8     AS last_touch,
               COALESCE(sum(t.credit_linear),0)::float8   AS linear,
               COALESCE(sum(t.credit_position),0)::float8 AS position,
               COALESCE(sum(t.credit_first * t.revenue),0)::float8    AS rev_first,
               COALESCE(sum(t.credit_last * t.revenue),0)::float8     AS rev_last,
               COALESCE(sum(t.credit_linear * t.revenue),0)::float8   AS rev_linear,
               COALESCE(sum(t.credit_position * t.revenue),0)::float8 AS rev_position
        FROM analytics.v_touch_base t WHERE ${touchWhere(sql, f, p)}
        GROUP BY 1 ORDER BY last_touch DESC, touches DESC LIMIT ${limit}`,
      sql<{ converted: number; unattributed: number; unattributed_revenue: number; pre_existing: number; never_touched: number; touched_after_only: number }[]>`
        SELECT count(*) FILTER (WHERE converted)::int AS converted,
               count(*) FILTER (WHERE unattributed_conversion)::int AS unattributed,
               COALESCE(sum(revenue) FILTER (WHERE unattributed_conversion),0)::float8 AS unattributed_revenue,
               count(*) FILTER (WHERE unattributed_conversion AND pre_existing_customer)::int AS pre_existing,
               count(*) FILTER (WHERE unattributed_conversion AND total_touches = 0)::int AS never_touched,
               count(*) FILTER (WHERE unattributed_conversion AND total_touches > 0)::int AS touched_after_only
        FROM analytics.v_lead_base l WHERE ${leadWhere(sql, f, p)}`,
    ]);
    const totLast = rows.reduce((s, r) => s + r.last_touch, 0);
    const totLin = rows.reduce((s, r) => s + r.linear, 0);
    const out = rows.map((r) => ({
      ...r,
      diff_last_vs_linear: Math.round((r.last_touch - r.linear) * 100) / 100,
      share_last: totLast ? Math.round((r.last_touch / totLast) * 10000) / 100 : null,
      share_linear: totLin ? Math.round((r.linear / totLin) * 10000) / 100 : null,
    }));
    return {
      dim, rows: out,
      totals: { first_touch: rows.reduce((s, r) => s + r.first_touch, 0), last_touch: totLast, linear: totLin, position: rows.reduce((s, r) => s + r.position, 0) },
      unattributed: unattr,
      note: 'Unattributed = converted leads with no touch on/before the payment date: never touched, touched only after paying, or pre-existing customers (paid before the lead was created). Credits exclude post-payment touches.',
    };
  }),
);
