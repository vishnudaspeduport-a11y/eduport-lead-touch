import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import { leadWhere, touchWhere, type Filters, type Period } from '../filters';

export const kpis = new Hono<AppEnv>();

export interface KpiSet {
  leads: number; converted: number; converted_new: number; pre_existing: number;
  revenue: number; refunds: number;
  first_touch_conversions: number; last_touch_conversions: number; unattributed: number;
  avg_touches_to_convert: number | null; median_touches_to_convert: number | null; p90_touches_to_convert: number | null;
  avg_days_to_convert: number | null; median_days_to_convert: number | null;
  contacted: number; median_response_hours: number | null;
  touches: number; valid_touches: number; touched_leads: number;
  touches_per_lead: number | null; conv_rate: number | null; revenue_per_lead: number | null; contact_rate: number | null;
  touch_buckets: { bucket: string; leads: number; converted: number }[];
}

export async function kpisFor(sql: Sql, f: Filters, p: Period): Promise<KpiSet> {
  const lw = leadWhere(sql, f, p);
  const tw = touchWhere(sql, f, p);
  const [[lead], [touch], buckets] = await Promise.all([
    sql<Omit<KpiSet, 'touches' | 'valid_touches' | 'touched_leads' | 'touches_per_lead' | 'conv_rate' | 'revenue_per_lead' | 'contact_rate' | 'touch_buckets'>[]>`
      SELECT count(*)::int AS leads,
             count(*) FILTER (WHERE converted)::int AS converted,
             count(*) FILTER (WHERE converted AND NOT pre_existing_customer)::int AS converted_new,
             count(*) FILTER (WHERE converted AND pre_existing_customer)::int AS pre_existing,
             COALESCE(sum(revenue),0)::float8 AS revenue,
             COALESCE(sum(refunds),0)::float8 AS refunds,
             count(*) FILTER (WHERE first_touch_conversion)::int AS first_touch_conversions,
             count(*) FILTER (WHERE last_touch_conversion)::int AS last_touch_conversions,
             count(*) FILTER (WHERE unattributed_conversion)::int AS unattributed,
             avg(valid_touches) FILTER (WHERE converted)::float8 AS avg_touches_to_convert,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY valid_touches) FILTER (WHERE converted))::float8 AS median_touches_to_convert,
             (percentile_cont(0.9) WITHIN GROUP (ORDER BY valid_touches) FILTER (WHERE converted))::float8 AS p90_touches_to_convert,
             avg(days_to_convert) FILTER (WHERE converted AND days_to_convert >= 0)::float8 AS avg_days_to_convert,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_convert) FILTER (WHERE converted AND days_to_convert >= 0))::float8 AS median_days_to_convert,
             count(*) FILTER (WHERE contacted)::int AS contacted,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY response_hours) FILTER (WHERE response_hours >= 0))::float8 AS median_response_hours
      FROM analytics.mv_lead_base l WHERE ${lw}`,
    sql<{ touches: number; valid_touches: number; touched_leads: number }[]>`
      SELECT count(*)::int AS touches,
             count(*) FILTER (WHERE t.is_pre_conversion)::int AS valid_touches,
             count(DISTINCT t.lead_id)::int AS touched_leads
      FROM analytics.mv_touch_base t WHERE ${tw}`,
    sql<{ bucket: string; leads: number; converted: number }[]>`
      SELECT touch_bucket AS bucket, count(*)::int AS leads, count(*) FILTER (WHERE converted)::int AS converted
      FROM analytics.mv_lead_base l WHERE ${lw}
      GROUP BY 1 ORDER BY CASE touch_bucket WHEN '6+' THEN 6 ELSE touch_bucket::int END`,
  ]);
  return {
    ...lead,
    ...touch,
    touches_per_lead: lead.leads ? Math.round((touch.touches / lead.leads) * 100) / 100 : null,
    conv_rate: pct(lead.converted, lead.leads),
    revenue_per_lead: lead.leads ? Math.round(lead.revenue / lead.leads) : null,
    contact_rate: pct(lead.contacted, lead.leads),
    touch_buckets: buckets,
  };
}

/** GET /api/kpis  -> { current, previous? } */
kpis.get('/kpis', (c) =>
  handle(c, async ({ sql, f, periods }) => {
    const [current, previous] = await Promise.all([
      kpisFor(sql, f, periods.current),
      periods.previous ? kpisFor(sql, f, periods.previous) : Promise.resolve(null),
    ]);
    return { current, previous };
  }),
);
