import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import type { Frag } from '../filters';
import { flatWhere } from './overview';

/**
 * GET /api/touch-attribution?mode=first|last  - the Tableau "Lead Touch - First Touch" / "Lead Touch - Last Touch" dashboards.
 * Touch grain, touch-date window, same per-dimension sheets (touch point, class, source, medium, campaign) with
 *   Total leads  = COUNTD(lead) over touches in the window with that value
 *   Converted    = COUNTD(lead) with any valid payment on/after such a touch           (workbook "Converted")
 *   first touch  = COUNTD(lead) whose *selected first touch* is such a touch and converted (workbook "first touch")
 *   last touch   = COUNTD(lead) whose *last valid touch* (latest touch strictly BEFORE its last payment day) is such a touch (workbook "lasttouch point count";
 *                  the workbook compares a touch timestamp with the payment DATE, which Tableau reads as midnight, so payment-day touches never qualify)
 *   percentage   = first touch / Total leads   |   % = Converted / Total leads
 * Selected first touch = the lead's earliest touch on/after 2026-03-01, else its latest touch (workbook LODs).
 */
export const touchAttribution = new Hono<AppEnv>();

export interface AttrRow { key: string; touches: number; leads: number; converted: number; attributed: number; conv_pct: number | null; attr_pct: number | null; share_pct: number | null }

async function byDim(sql: Sql, w: Frag, col: string, flag: Frag, limit = 40): Promise<AttrRow[]> {
  const rows = await sql<{ key: string; touches: number; leads: number; converted: number; attributed: number }[]>`
    SELECT COALESCE(t.${sql(col)}::text, '(null)') AS key, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
           count(DISTINCT t.lead_id) FILTER (WHERE t.tab_converted)::int AS converted,
           count(DISTINCT t.lead_id) FILTER (WHERE ${flag})::int AS attributed
    FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY attributed DESC, leads DESC LIMIT ${limit}`;
  const totalAttr = rows.reduce((s, r) => s + r.attributed, 0);
  return rows.map((r) => ({ ...r, conv_pct: pct(r.converted, r.leads), attr_pct: pct(r.attributed, r.leads), share_pct: pct(r.attributed, totalAttr) }));
}

touchAttribution.get('/touch-attribution', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const mode = q.mode === 'last' ? 'last' : 'first';
    const w = flatWhere(sql, f, periods.current);
    const flag = mode === 'first' ? sql`t.tab_is_first_touch AND t.tab_converted` : sql`t.tab_is_last_touch`;
    const [[k], touchPoint, classRaw, source, medium, campaign, daily] = await Promise.all([
      sql<{ touches: number; leads: number; converted: number; attributed: number; attributed_touches: number }[]>`
        SELECT count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE t.tab_converted)::int AS converted,
               count(DISTINCT t.lead_id) FILTER (WHERE ${flag})::int AS attributed,
               count(*) FILTER (WHERE ${mode === 'first' ? sql`t.tab_is_first_touch` : sql`t.tab_is_last_touch`})::int AS attributed_touches
        FROM analytics.mv_touch_flat t WHERE ${w}`,
      byDim(sql, w, 'touch_point', flag), byDim(sql, w, 'class_raw', flag), byDim(sql, w, 'source', flag), byDim(sql, w, 'medium', flag), byDim(sql, w, 'campaign', flag),
      sql<{ d: string; leads: number; attributed: number }[]>`
        SELECT t.touch_date::text AS d, count(DISTINCT t.lead_id)::int AS leads, count(DISTINCT t.lead_id) FILTER (WHERE ${flag})::int AS attributed
        FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY 1`,
    ]);
    const label = mode === 'first' ? 'First-touch conversions' : 'Last-touch conversions';
    return {
      mode, period: periods.current,
      kpis: { ...k, conv_pct: pct(k.converted, k.leads), attr_pct: pct(k.attributed, k.leads), attr_of_converted_pct: pct(k.attributed, k.converted) },
      touch_point: touchPoint, class_raw: classRaw, source, medium, campaign, daily,
      definitions: {
        leads: 'Tableau "Total leads": distinct leads with a touch in the window (per row: with a touch of that value).',
        converted: 'Tableau "Converted": distinct touched leads with any valid payment dated on/after such a touch.',
        attributed: mode === 'first'
          ? 'Tableau "first touch": converted leads whose selected first touch is in the window (per row: has that value). Selected first touch = the lead\'s earliest touch on/after 1 Mar 2026, or its latest touch if it has none after that date. Each converted lead is credited to exactly one touch point / source / medium / campaign / class.'
          : 'Tableau "lasttouch point count": leads whose last valid touch is in the window (per row: has that value). Last valid touch = the latest touch dated strictly BEFORE the day of the lead\'s last valid payment: the workbook compares the touch timestamp with the payment date read as midnight, so touches on the payment day itself never qualify. Each such lead is credited to exactly one touch point / source / medium / campaign / class. Verified against the workbook for Sep 2026 (Eduport App 1,644 vs 1,639).',
        attr_pct: mode === 'first' ? 'Tableau "percentage": first-touch conversions ÷ Total leads.' : 'Last-touch conversions ÷ Total leads (the workbook shows Converted ÷ Total leads as "%").',
        share_pct: `${label} of this row ÷ ${label.toLowerCase()} of all rows in the table (adds up to 100%).`,
        conv_pct: 'Tableau "%": Converted ÷ Total leads.',
      },
    };
  }),
);
