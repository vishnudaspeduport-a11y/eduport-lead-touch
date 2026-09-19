import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, intParam, pct } from '../http';
import { leadWhere, touchWhere } from '../filters';

export const team = new Hono<AppEnv>();

/**
 * GET /api/team : per owner (Lead_Master__c.OwnerId) and per touch staff.
 * Fairness: every rate is normalised by leads assigned to that owner, not by raw conversions.
 */
team.get('/team', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const limit = intParam(q, 'limit', 100, 1, 500);
    const p = periods.current;
    const [owners, staff] = await Promise.all([
      sql<{
        owner_name: string; owner_id: string | null; leads: number; contacted: number; touches: number; avg_touches: number | null;
        converted: number; revenue: number; median_response_hours: number | null; call_attempts: number; calls_connected: number;
        avg_call_seconds: number | null; leads_with_calls: number; open_leads: number; stale_7d: number;
      }[]>`
        SELECT l.owner_name, min(l.owner_id) AS owner_id, count(*)::int AS leads,
               count(*) FILTER (WHERE l.contacted)::int AS contacted,
               COALESCE(sum(l.total_touches),0)::int AS touches,
               avg(l.valid_touches)::float8 AS avg_touches,
               count(*) FILTER (WHERE l.converted)::int AS converted,
               COALESCE(sum(l.revenue),0)::float8 AS revenue,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY l.response_hours) FILTER (WHERE l.response_hours >= 0))::float8 AS median_response_hours,
               COALESCE(sum(c.call_attempts),0)::int AS call_attempts,
               COALESCE(sum(c.calls_connected),0)::int AS calls_connected,
               avg(c.call_seconds_avg)::float8 AS avg_call_seconds,
               count(c.lead_id)::int AS leads_with_calls,
               count(*) FILTER (WHERE l.is_open)::int AS open_leads,
               count(*) FILTER (WHERE l.is_open AND (l.last_touch_any_at IS NULL OR l.last_touch_any_at < now() - interval '7 days'))::int AS stale_7d
        FROM analytics.mv_lead_base l LEFT JOIN analytics.mv_lead_calls c ON c.lead_id = l.lead_id
        WHERE ${leadWhere(sql, f, p)}
        GROUP BY 1 ORDER BY leads DESC LIMIT ${limit}`,
      sql<{ staff: string; touches: number; leads: number; conv_last: number; conv_linear: number; revenue_linear: number; converted_leads: number }[]>`
        SELECT t.staff, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               COALESCE(sum(t.credit_last),0)::float8 AS conv_last, COALESCE(sum(t.credit_linear),0)::float8 AS conv_linear,
               COALESCE(sum(t.credit_linear * t.revenue),0)::float8 AS revenue_linear,
               count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted_leads
        FROM analytics.mv_touch_base t WHERE ${touchWhere(sql, f, p)} AND t.staff IS NOT NULL
        GROUP BY 1 ORDER BY touches DESC LIMIT ${limit}`,
    ]);
    return {
      owners: owners.map((o) => ({
        ...o,
        contact_rate: pct(o.contacted, o.leads),
        conv_rate: pct(o.converted, o.leads),
        revenue_per_lead: o.leads ? Math.round(o.revenue / o.leads) : null,
        connect_rate: pct(o.calls_connected, o.call_attempts),
        calls_per_lead: o.leads ? Math.round((o.call_attempts / o.leads) * 100) / 100 : null,
      })),
      staff: staff.map((s) => ({ ...s, touches_per_lead: s.leads ? Math.round((s.touches / s.leads) * 100) / 100 : null, conv_rate: pct(s.converted_leads, s.leads) })),
      fairness_note: 'Compare owners on conversion % (converted / leads assigned), contact rate and median response time - never on raw conversions, which mostly reflect how many leads an owner was assigned. Call stats join Task on the normalised phone, so a phone shared by several leads is counted for each.',
    };
  }),
);
