import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, intParam, pct } from '../http';
import { dimExpr, isLeadDim, leadWhere, touchWhere, type LeadDim } from '../filters';

export const touch = new Hono<AppEnv>();

const BUCKETS = ['0', '1', '2', '3', '4', '5', '6+'];

interface CurveRow { grp: string; bucket: string; leads: number; converted: number; revenue: number; }

/**
 * GET /api/touch-curve[&by=lead_source]
 * Conversion rate by number of pre-conversion touches, marginal lift per extra
 * touch and a recommended "optimal touch count" per group.
 * Rule: optimal = the largest bucket k whose marginal lift over k-1 is still
 * >= max(0.5 pp, 10% of the biggest lift seen) AND has >= 30 leads. Buckets with
 * < 30 leads are ignored (too noisy).
 */
touch.get('/touch-curve', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const by = q.by && isLeadDim(q.by) ? (q.by as LeadDim) : null;
    const grpExpr = by ? dimExpr(sql, by, 'l') : sql`'All'::text`;
    const rows = await sql<CurveRow[]>`
      SELECT ${grpExpr} AS grp, l.touch_bucket AS bucket, count(*)::int AS leads,
             count(*) FILTER (WHERE l.converted)::int AS converted, COALESCE(sum(l.revenue),0)::float8 AS revenue
      FROM analytics.mv_lead_base l WHERE ${leadWhere(sql, f, periods.current)}
      GROUP BY 1,2`;
    const groups = new Map<string, CurveRow[]>();
    for (const r of rows) (groups.get(r.grp) ?? groups.set(r.grp, []).get(r.grp)!).push(r);
    const out = [...groups.entries()]
      .map(([grp, rs]) => {
        const byB = new Map(rs.map((r) => [r.bucket, r]));
        const pts = BUCKETS.map((b) => {
          const r = byB.get(b);
          return { bucket: b, leads: r?.leads ?? 0, converted: r?.converted ?? 0, conv_rate: pct(r?.converted, r?.leads), revenue: r?.revenue ?? 0 };
        });
        const lifts = pts.map((p, i) => (i === 0 || p.conv_rate == null || pts[i - 1].conv_rate == null ? null : Math.round((p.conv_rate - (pts[i - 1].conv_rate as number)) * 100) / 100));
        const maxLift = Math.max(0, ...lifts.filter((x): x is number => x != null));
        const threshold = Math.max(0.5, maxLift * 0.1);
        let optimal: string | null = null;
        for (let i = 1; i < pts.length; i++) {
          if (pts[i].leads >= 30 && lifts[i] != null && (lifts[i] as number) >= threshold) optimal = pts[i].bucket;
        }
        const totalLeads = pts.reduce((s, p) => s + p.leads, 0);
        return { group: grp, total_leads: totalLeads, points: pts.map((p, i) => ({ ...p, marginal_lift_pp: lifts[i] })), optimal_touches: optimal };
      })
      .sort((a, b) => b.total_leads - a.total_leads)
      .slice(0, 20);
    return { by, groups: out, rule: 'optimal = largest touch count whose marginal lift is >= max(0.5pp, 10% of the biggest lift) with >= 30 leads' };
  }),
);

/** GET /api/touch-gaps : distribution of time between consecutive touches + conversion by gap bucket */
touch.get('/touch-gaps', (c) =>
  handle(c, async ({ sql, f, periods }) => {
    const tw = touchWhere(sql, f, periods.current);
    const [buckets, [overall]] = await Promise.all([
      sql<{ bucket: string; touches: number; leads: number; converted_leads: number; median_hours: number | null }[]>`
        SELECT t.gap_bucket AS bucket, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE t.converted)::int AS converted_leads,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY t.gap_hours_from_prev))::float8 AS median_hours
        FROM analytics.mv_touch_base t
        WHERE ${tw} AND t.gap_hours_from_prev IS NOT NULL AND t.is_pre_conversion
        GROUP BY 1
        ORDER BY min(t.gap_hours_from_prev)`,
      sql<{ median_hours: number | null; avg_hours: number | null; p90_hours: number | null; gaps: number }[]>`
        SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY t.gap_hours_from_prev))::float8 AS median_hours,
               avg(t.gap_hours_from_prev)::float8 AS avg_hours,
               (percentile_cont(0.9) WITHIN GROUP (ORDER BY t.gap_hours_from_prev))::float8 AS p90_hours,
               count(*)::int AS gaps
        FROM analytics.mv_touch_base t
        WHERE ${tw} AND t.gap_hours_from_prev IS NOT NULL AND t.is_pre_conversion`,
    ]);
    return { buckets: buckets.map((b) => ({ ...b, conv_rate: pct(b.converted_leads, b.leads) })), overall };
  }),
);

/** GET /api/touch-heatmap : day-of-week x hour (IST) */
touch.get('/touch-heatmap', (c) =>
  handle(c, async ({ sql, f, periods }) => {
    const rows = await sql<{ dow: number; hour: number; touches: number; converted_touches: number; leads: number }[]>`
      SELECT t.touch_dow AS dow, t.touch_hour AS hour, count(*)::int AS touches,
             count(*) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted_touches,
             count(DISTINCT t.lead_id)::int AS leads
      FROM analytics.mv_touch_base t WHERE ${touchWhere(sql, f, periods.current)}
      GROUP BY 1,2 ORDER BY 1,2`;
    return { rows, tz: 'Asia/Kolkata' };
  }),
);

/** GET /api/touch-transitions : first touch point -> last touch point matrix */
touch.get('/touch-transitions', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const limit = intParam(q, 'limit', 300, 1, 2000);
    const rows = await sql<{ src: string; dst: string; leads: number; converted: number; revenue: number }[]>`
      SELECT COALESCE(l.first_touch_point,'(none)') AS src,
             COALESCE(l.last_touch_point, l.last_touch_any_point, '(none)') AS dst,
             count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted,
             COALESCE(sum(l.revenue),0)::float8 AS revenue
      FROM analytics.mv_lead_base l WHERE ${leadWhere(sql, f, periods.current)} AND l.total_touches >= 1
      GROUP BY 1,2 ORDER BY 3 DESC LIMIT ${limit}`;
    return { rows: rows.map((r) => ({ ...r, conv_rate: pct(r.converted, r.leads), same: r.src === r.dst })) };
  }),
);

/** GET /api/stale-leads?days=7&page=1&limit=50 : open leads whose last touch is older than N days */
touch.get('/stale-leads', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const days = intParam(q, 'days', 7, 1, 365);
    const limit = intParam(q, 'limit', 50, 1, 200);
    const page = intParam(q, 'page', 1, 1, 10000);
    const lw = leadWhere(sql, f, periods.current);
    const cond = sql`${lw} AND l.is_open AND (l.last_touch_any_at IS NULL OR l.last_touch_any_at < now() - make_interval(days => ${days}))`;
    const [rows, [tot], byOwner] = await Promise.all([
      sql`
        SELECT l.lead_id, l.lead_name, l.created_date::text, l.lead_source, l.lead_stage, l.owner_name, l.class_group,
               l.total_touches, l.last_touch_any_at::text AS last_touch_at, l.last_touch_any_point AS last_touch_point,
               (current_date - analytics.ist_date(l.last_touch_any_at))::int AS days_since_touch,
               l.next_followup_due::text, l.priority, l.app_engagement_tier
        FROM analytics.mv_lead_base l WHERE ${cond}
        ORDER BY l.last_touch_any_at NULLS FIRST, l.created_at LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      sql<{ n: number; never: number }[]>`SELECT count(*)::int AS n, count(*) FILTER (WHERE l.last_touch_any_at IS NULL)::int AS never FROM analytics.mv_lead_base l WHERE ${cond}`,
      sql<{ owner_name: string; n: number }[]>`SELECT l.owner_name, count(*)::int AS n FROM analytics.mv_lead_base l WHERE ${cond} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
    ]);
    return { days, page, limit, total: tot.n, never_touched: tot.never, rows, by_owner: byOwner };
  }),
);
