import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import { leadWhere } from '../filters';

export const cohorts = new Hono<AppEnv>();

/**
 * GET /api/cohorts?grain=month|week
 * Cohort = lead created month/week (always created basis). Conversion at 7/14/30/60/90 days
 * = converted with days_to_convert <= N. Immature cells are flagged (age_days < N).
 */
cohorts.get('/cohorts', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const grain = q.grain === 'week' ? 'week' : 'month';
    const fc = { ...f, basis: 'created' as const };
    const lw = leadWhere(sql, fc, periods.current);
    const [rows, hist, [share]] = await Promise.all([
      sql<{ cohort: string; leads: number; c7: number; c14: number; c30: number; c60: number; c90: number; c_all: number; revenue: number; age_days: number }[]>`
        SELECT date_trunc(${grain}, l.created_date::timestamp)::date::text AS cohort,
               count(*)::int AS leads,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 7)::int  AS c7,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 14)::int AS c14,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 30)::int AS c30,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 60)::int AS c60,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 90)::int AS c90,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert >= 0)::int AS c_all,
               COALESCE(sum(l.revenue),0)::float8 AS revenue,
               (current_date - max(l.created_date))::int AS age_days
        FROM analytics.v_lead_base l WHERE ${lw}
        GROUP BY 1 ORDER BY 1`,
      sql<{ bucket: string; ord: number; leads: number; revenue: number }[]>`
        SELECT CASE WHEN l.days_to_convert < 0 THEN 'Before lead (pre-existing)'
                    WHEN l.days_to_convert = 0 THEN 'Same day'
                    WHEN l.days_to_convert <= 3 THEN '1-3 days'
                    WHEN l.days_to_convert <= 7 THEN '4-7 days'
                    WHEN l.days_to_convert <= 14 THEN '8-14 days'
                    WHEN l.days_to_convert <= 30 THEN '15-30 days'
                    WHEN l.days_to_convert <= 60 THEN '31-60 days'
                    WHEN l.days_to_convert <= 90 THEN '61-90 days'
                    ELSE '90+ days' END AS bucket,
               CASE WHEN l.days_to_convert < 0 THEN -1 WHEN l.days_to_convert = 0 THEN 0 WHEN l.days_to_convert <= 3 THEN 1
                    WHEN l.days_to_convert <= 7 THEN 2 WHEN l.days_to_convert <= 14 THEN 3 WHEN l.days_to_convert <= 30 THEN 4
                    WHEN l.days_to_convert <= 60 THEN 5 WHEN l.days_to_convert <= 90 THEN 6 ELSE 7 END AS ord,
               count(*)::int AS leads, COALESCE(sum(l.revenue),0)::float8 AS revenue
        FROM analytics.v_lead_base l WHERE ${lw} AND l.converted
        GROUP BY 1,2 ORDER BY 2`,
      sql<{ converted: number; within_7: number; within_30: number }[]>`
        SELECT count(*) FILTER (WHERE l.converted AND l.days_to_convert >= 0)::int AS converted,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 7)::int AS within_7,
               count(*) FILTER (WHERE l.converted AND l.days_to_convert BETWEEN 0 AND 30)::int AS within_30
        FROM analytics.v_lead_base l WHERE ${lw} AND l.created_date <= current_date - 90`,
    ]);
    const out = rows.map((r) => ({
      ...r,
      r7: pct(r.c7, r.leads), r14: pct(r.c14, r.leads), r30: pct(r.c30, r.leads), r60: pct(r.c60, r.leads), r90: pct(r.c90, r.leads), r_all: pct(r.c_all, r.leads),
      mature: { d7: r.age_days >= 7, d14: r.age_days >= 14, d30: r.age_days >= 30, d60: r.age_days >= 60, d90: r.age_days >= 90 },
      first_week_share: pct(r.c7, r.c_all),
    }));
    return {
      grain, rows: out, days_to_convert: hist,
      first_week_share: { ...share, share_7: pct(share.within_7, share.converted), share_30: pct(share.within_30, share.converted), note: 'Cohorts at least 90 days old only' },
    };
  }),
);
