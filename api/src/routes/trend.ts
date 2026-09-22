import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle } from '../http';
import { canUseDailyMv, leadWhere, touchWhere, type Filters, type Period } from '../filters';

export const trend = new Hono<AppEnv>();

export interface TrendRow { d: string; leads: number; converted: number; revenue: number; touches: number; }
type Grain = 'day' | 'week' | 'month';

async function trendFor(sql: Sql, f: Filters, p: Period, grain: Grain): Promise<{ rows: TrendRow[]; source: string }> {
  if (f.basis === 'touch') {
    const rows = await sql<TrendRow[]>`
      SELECT date_trunc(${grain}, t.touch_date::timestamp)::date::text AS d,
             count(DISTINCT t.lead_id)::int AS leads,
             count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted,
             0::float8 AS revenue,
             count(*)::int AS touches
      FROM analytics.v_touch_base t WHERE ${touchWhere(sql, f, p)}
      GROUP BY 1 ORDER BY 1`;
    return { rows, source: 'mv_touch_base' };
  }
  if (false && canUseDailyMv(f)) {   // mv_daily_lead_stats dropped to save space (2026-09-22)
    const rows = await sql<TrendRow[]>`
      SELECT date_trunc(${grain}, l.created_date::timestamp)::date::text AS d,
             sum(l.leads)::int AS leads, sum(l.converted)::int AS converted,
             COALESCE(sum(l.revenue),0)::float8 AS revenue, COALESCE(sum(l.total_touches),0)::int AS touches
      FROM analytics.mv_daily_lead_stats l WHERE ${leadWhere(sql, f, p)}
      GROUP BY 1 ORDER BY 1`;
    return { rows, source: 'mv_daily_lead_stats' };
  }
  const dateCol = f.basis === 'payment' ? sql`l.converted_at` : sql`l.created_date`;
  const rows = await sql<TrendRow[]>`
    SELECT date_trunc(${grain}, ${dateCol}::timestamp)::date::text AS d,
           count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted,
           COALESCE(sum(l.revenue),0)::float8 AS revenue, COALESCE(sum(l.total_touches),0)::int AS touches
    FROM analytics.v_lead_base l WHERE ${leadWhere(sql, f, p)}
    GROUP BY 1 ORDER BY 1`;
  return { rows, source: 'mv_lead_base' };
}

/** GET /api/trend?grain=day|week|month */
trend.get('/trend', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const grain: Grain = q.grain === 'week' || q.grain === 'month' ? q.grain : 'day';
    const [cur, prev] = await Promise.all([
      trendFor(sql, f, periods.current, grain),
      periods.previous ? trendFor(sql, f, periods.previous, grain) : Promise.resolve(null),
    ]);
    return { grain, source: cur.source, rows: cur.rows, previous: prev?.rows ?? null };
  }),
);
