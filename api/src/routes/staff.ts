import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import { flatWhere } from './overview';

/**
 * GET /api/staff?by=staff|owner  - "Staff & follow-up" page.
 *  Performance table (touch grain, touch-date window):
 *    by=staff : Lead_Touch__c.Staff__c   - the person who made the touch
 *    by=owner : Lead_Master__c.OwnerId   - the person who owns the lead
 *    leads touched, touches, converted (workbook rule), first-/last-touch credited conversions,
 *    revenue of last-touch-credited leads (amount), linear-credit revenue share,
 *    median response hours = lead created -> first touch in the window, for leads created inside the window.
 *  Going cold: leads touched in the window, never paid, stage <> Disqualified, whose LAST touch of any kind
 *    (all time, not only the window) is older than 7 / 14 / 30 days.
 */
export const staff = new Hono<AppEnv>();

export interface StaffRow { key: string; leads: number; touches: number; converted: number; first_touch_conv: number; last_touch_conv: number; revenue_last: number; revenue_linear: number; median_response_h: number | null; new_leads: number; conv_pct: number | null }
export interface ColdRow { key: string; open: number; gt7: number; gt14: number; gt30: number }

staff.get('/staff', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const by = q.by === 'owner' ? 'owner' : 'staff';
    const w = flatWhere(sql, f, periods.current);
    const col = by === 'owner' ? sql`t.owner_name` : sql`t.staff`;
    const [rows, [k], [cold], coldStaff, coldTouchPoint, coldStage, coldAge] = await Promise.all([
      sql<StaffRow[]>`
        WITH per_lead AS (
          SELECT ${col} AS key, t.lead_id, min(t.touch_at) AS first_touch_at, max(t.lead_created_at) AS created_at,
                 (max(t.lead_created_date) BETWEEN ${periods.current.from} AND ${periods.current.to}) AS created_in_window,
                 bool_or(t.tab_converted) AS conv, bool_or(t.tab_is_last_touch) AS last_conv, bool_or(t.tab_is_first_touch AND t.tab_converted) AS first_conv,
                 max(t.revenue) AS revenue, sum(t.credit_linear * t.revenue) AS rev_linear, count(*) AS touches
          FROM analytics.mv_touch_flat t WHERE ${w} AND ${col} IS NOT NULL
          GROUP BY 1, 2)
        SELECT key, count(*)::int AS leads, sum(touches)::int AS touches,
               count(*) FILTER (WHERE conv)::int AS converted,
               count(*) FILTER (WHERE first_conv)::int AS first_touch_conv,
               count(*) FILTER (WHERE last_conv)::int AS last_touch_conv,
               COALESCE(sum(revenue) FILTER (WHERE last_conv), 0)::float8 AS revenue_last,
               COALESCE(sum(rev_linear), 0)::float8 AS revenue_linear,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM first_touch_at - created_at) / 3600)
                  FILTER (WHERE created_in_window AND first_touch_at >= created_at))::float8 AS median_response_h,
               count(*) FILTER (WHERE created_in_window)::int AS new_leads
        FROM per_lead GROUP BY key ORDER BY leads DESC LIMIT 60`,
      sql<{ leads: number; touches: number; converted: number; last_touch_conv: number; revenue_last: number; median_response_h: number | null; new_leads: number; with_staff: number }[]>`
        WITH per_lead AS (
          SELECT t.lead_id, min(t.touch_at) AS first_touch_at, max(t.lead_created_at) AS created_at,
                 (max(t.lead_created_date) BETWEEN ${periods.current.from} AND ${periods.current.to}) AS created_in_window,
                 bool_or(t.tab_converted) AS conv, bool_or(t.tab_is_last_touch) AS last_conv, max(t.revenue) AS revenue, count(*) AS touches,
                 bool_or(${col} IS NOT NULL) AS has_key
          FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1)
        SELECT count(*)::int AS leads, sum(touches)::int AS touches, count(*) FILTER (WHERE conv)::int AS converted, count(*) FILTER (WHERE last_conv)::int AS last_touch_conv,
               COALESCE(sum(revenue) FILTER (WHERE last_conv), 0)::float8 AS revenue_last,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM first_touch_at - created_at) / 3600) FILTER (WHERE created_in_window AND first_touch_at >= created_at))::float8 AS median_response_h,
               count(*) FILTER (WHERE created_in_window)::int AS new_leads, count(*) FILTER (WHERE has_key)::int AS with_staff
        FROM per_lead`,
      // going cold: open leads touched in the window; age = days since their last touch of any kind
      sql<{ open: number; gt7: number; gt14: number; gt30: number }[]>`
        WITH o AS (SELECT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 HAVING NOT bool_or(t.converted) AND COALESCE(max(t.lead_stage), '') <> 'Disqualified'),
        la AS (SELECT t.lead_id, EXTRACT(epoch FROM now() - max(t.touch_at)) / 86400 AS age FROM analytics.mv_touch_flat t JOIN o USING (lead_id) GROUP BY 1)
        SELECT count(*)::int AS open, count(*) FILTER (WHERE age > 7)::int AS gt7, count(*) FILTER (WHERE age > 14)::int AS gt14, count(*) FILTER (WHERE age > 30)::int AS gt30 FROM la`,
      sql<ColdRow[]>`
        WITH o AS (SELECT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 HAVING NOT bool_or(t.converted) AND COALESCE(max(t.lead_stage), '') <> 'Disqualified'),
        la AS (SELECT t.lead_id, EXTRACT(epoch FROM now() - max(t.touch_at)) / 86400 AS age FROM analytics.mv_touch_flat t JOIN o USING (lead_id) GROUP BY 1),
        k AS (SELECT DISTINCT ${col} AS key, t.lead_id FROM analytics.mv_touch_flat t WHERE ${w} AND ${col} IS NOT NULL)
        SELECT k.key, count(*)::int AS open, count(*) FILTER (WHERE la.age > 7)::int AS gt7, count(*) FILTER (WHERE la.age > 14)::int AS gt14, count(*) FILTER (WHERE la.age > 30)::int AS gt30
        FROM k JOIN la USING (lead_id) GROUP BY 1 ORDER BY gt7 DESC LIMIT 60`,
      sql<ColdRow[]>`
        WITH o AS (SELECT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 HAVING NOT bool_or(t.converted) AND COALESCE(max(t.lead_stage), '') <> 'Disqualified'),
        la AS (SELECT t.lead_id, EXTRACT(epoch FROM now() - max(t.touch_at)) / 86400 AS age FROM analytics.mv_touch_flat t JOIN o USING (lead_id) GROUP BY 1),
        k AS (SELECT DISTINCT t.touch_point AS key, t.lead_id FROM analytics.mv_touch_flat t WHERE ${w})
        SELECT k.key, count(*)::int AS open, count(*) FILTER (WHERE la.age > 7)::int AS gt7, count(*) FILTER (WHERE la.age > 14)::int AS gt14, count(*) FILTER (WHERE la.age > 30)::int AS gt30
        FROM k JOIN la USING (lead_id) GROUP BY 1 ORDER BY gt7 DESC LIMIT 20`,
      sql<ColdRow[]>`
        WITH o AS (SELECT t.lead_id, max(t.lead_stage) AS key FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 HAVING NOT bool_or(t.converted) AND COALESCE(max(t.lead_stage), '') <> 'Disqualified'),
        la AS (SELECT t.lead_id, EXTRACT(epoch FROM now() - max(t.touch_at)) / 86400 AS age FROM analytics.mv_touch_flat t JOIN o USING (lead_id) GROUP BY 1)
        SELECT o.key, count(*)::int AS open, count(*) FILTER (WHERE la.age > 7)::int AS gt7, count(*) FILTER (WHERE la.age > 14)::int AS gt14, count(*) FILTER (WHERE la.age > 30)::int AS gt30
        FROM o JOIN la USING (lead_id) GROUP BY 1 ORDER BY open DESC`,
      sql<{ bucket: string; n: number }[]>`
        WITH o AS (SELECT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 HAVING NOT bool_or(t.converted) AND COALESCE(max(t.lead_stage), '') <> 'Disqualified'),
        la AS (SELECT t.lead_id, EXTRACT(epoch FROM now() - max(t.touch_at)) / 86400 AS age FROM analytics.mv_touch_flat t JOIN o USING (lead_id) GROUP BY 1)
        SELECT CASE WHEN age <= 3 THEN '0-3 days' WHEN age <= 7 THEN '4-7 days' WHEN age <= 14 THEN '8-14 days' WHEN age <= 30 THEN '15-30 days' WHEN age <= 60 THEN '31-60 days' ELSE '60+ days' END AS bucket, count(*)::int AS n
        FROM la GROUP BY 1 ORDER BY min(age)`,
    ]);
    return {
      by, period: periods.current,
      kpis: { ...k, conv_pct: pct(k.converted, k.leads), staff_coverage_pct: pct(k.with_staff, k.leads) },
      rows: rows.map((r) => ({ ...r, conv_pct: pct(r.converted, r.leads) })),
      cold: { ...cold, by_key: coldStaff, by_touch_point: coldTouchPoint, by_stage: coldStage, age: coldAge },
      definitions: {
        leads: by === 'staff' ? 'Distinct leads this staff member touched in the window (Lead_Touch__c.Staff__c). A lead touched by two people counts for both.' : 'Distinct leads owned by this person (Lead_Master__c.Owner) that were touched in the window.',
        converted: 'Workbook rule: the lead has a valid payment dated on/after one of these touches.',
        first_touch_conv: 'Converted leads whose selected first touch (earliest touch on/after 1 Mar 2026) was made by this person.',
        last_touch_conv: 'Leads whose last valid touch (latest touch on/before their last payment) was made by this person: the conversion is credited to them.',
        revenue_last: 'Sum of the payment amounts (all valid payments) of the leads credited by last touch.',
        revenue_linear: 'Revenue split equally across all touches before the payment; this person\'s share.',
        median_response_h: 'Median hours from lead creation to the first touch in the window, for leads created inside the window. Touches before creation are ignored.',
        cold: 'Open leads = touched in the window, no valid payment ever, stage not Disqualified. Age = days since the lead\'s last touch of any kind, in any month. Counted under every staff member who touched the lead in the window.',
      },
    };
  }),
);
