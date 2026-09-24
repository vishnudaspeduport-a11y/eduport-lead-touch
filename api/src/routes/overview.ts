import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import { LIST_KEYS, paymentPeriod, type Filters, type Frag, type Period } from '../filters';

/**
 * GET /api/overview  - everything on the Tableau "Lead Touch - Overview" dashboard in one call.
 * Grain = TOUCH, exactly like the workbook (Lead_Touch__c LEFT JOIN Lead_Master__c ... payments):
 *   Total leads        = COUNTD(lead)                    over touches in the window
 *   Total lead touches = COUNTD(touch)                   over touches in the window
 *   Converted          = COUNTD(lead) where the lead has ANY valid payment dated on/after the touch day
 *   Avg touches before conversion = AVG over touch rows of converted leads of {FIXED lead: COUNTD(touch)} (all-time touch count)
 *                        - KPI 1 has no date filter in the workbook, KPI 2 ("date-wise") has the touch-date filter
 * Reads only analytics.mv_touch_flat (+ interested courses for the IC funnel).
 */
export const overview = new Hono<AppEnv>();

/** filter key -> column on mv_touch_flat */
export const FLAT_COLS: Partial<Record<(typeof LIST_KEYS)[number], string>> = {
  lead_source: 'lead_source', lead_stage: 'lead_stage', class_group: 'class_group', class_raw: 'class_raw', district: 'district', city: 'city',
  priority: 'priority', lead_type: 'lead_type', owner: 'owner_name', ic_status: 'best_ic_status',
  lm_reason: 'lm_reason', source: 'source', medium: 'medium', touch_point: 'touch_point', campaign: 'campaign', staff: 'staff',
};

/** "Converted" for the current filters: workbook rule (any valid payment on/after the touch day), or - when the
 *  payment-date window is switched on - a valid payment dated inside that window and on/after the touch day. */
export function convCond(sql: Sql, f: Filters): Frag {
  const pp = paymentPeriod(f);
  if (!pp) return sql`t.tab_converted`;
  return sql`EXISTS (SELECT 1 FROM app.home_payment hp WHERE hp.user_id = t.app_user_id AND hp.payment_method = 0 AND hp.deleted = false
                     AND hp.is_success = true AND hp.payment_success = true AND hp.payment_date BETWEEN ${pp.from} AND ${pp.to}
                     AND hp.payment_date >= t.touch_date)`;   // still on/after the touch day, as in the workbook
}
/** first valid payment on/after a touch (brief definition), within the payment window when it is on */
export function convFirstCond(sql: Sql, f: Filters): Frag {
  const pp = paymentPeriod(f);
  return pp ? sql`(t.converted AND t.is_pre_conversion AND t.converted_at BETWEEN ${pp.from} AND ${pp.to})` : sql`(t.converted AND t.is_pre_conversion)`;
}

/** main window: basis=created -> leads created in the range (all their touches); otherwise touches dated in the range */
export function flatWhere(sql: Sql, f: Filters, p: Period | null): Frag {
  const c: Frag[] = [];
  if (p) c.push(f.basis === 'created' ? sql`t.lead_created_date BETWEEN ${p.from} AND ${p.to}` : sql`t.touch_date BETWEEN ${p.from} AND ${p.to}`);
  if (f.dups !== '1') c.push(sql`t.is_duplicate = false`);
  if (f.converted === '1') c.push(sql`${convCond(sql, f)}`);
  if (f.converted === '0') c.push(sql`NOT ${convCond(sql, f)}`);
  if (f.paid) c.push(f.paid === 'paid' ? sql`t.is_paid_lead = true` : sql`t.is_paid_lead IS NOT TRUE`);
  if (f.paid_touch) c.push(f.paid_touch === 'paid' ? sql`t.is_paid_touch = true` : sql`t.is_paid_touch IS NOT TRUE`);
  for (const k of LIST_KEYS) {
    const col = FLAT_COLS[k]; const vals = f[k];
    if (!col || !vals?.length) continue;
    if (k === 'ic_status') {
      // same source as the IC-status funnel: any interested course of the lead in one of these statuses
      const real = vals.filter((v) => v !== '(null)');
      if (real.length) c.push(sql`t.lead_id IN (SELECT ic.lead_master__c FROM salesforce.interested_course__c ic WHERE NOT ic.isdeleted AND btrim(ic.status__c) IN ${sql(real)})`);
      continue;
    }
    const hasNull = vals.includes('(null)'); const real = vals.filter((v) => v !== '(null)');
    const ref = sql`t.${sql(col)}`;
    if (hasNull && real.length) c.push(sql`(${ref} IN ${sql(real)} OR ${ref} IS NULL)`);
    else if (hasNull) c.push(sql`${ref} IS NULL`);
    else c.push(sql`${ref} IN ${sql(real)}`);
  }
  return c.reduce((a, x) => sql`${a} AND ${x}`, sql`true`);
}

export interface DimRow { key: string; touches: number; leads: number; converted: number; converted_first: number; conv_rate?: number | null }

async function byDim(sql: Sql, w: Frag, col: string, conv: Frag, convFirst: Frag, limit = 40): Promise<DimRow[]> {
  const rows = await sql<DimRow[]>`
    SELECT COALESCE(t.${sql(col)}::text, '(null)') AS key, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
           count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted,
           count(DISTINCT t.lead_id) FILTER (WHERE ${convFirst})::int AS converted_first
    FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY touches DESC LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, conv_rate: pct(r.converted, r.leads) }));
}

overview.get('/overview', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const w = flatWhere(sql, f, periods.current);
    const wAll = flatWhere(sql, f, null);
    const conv = convCond(sql, f); const convFirst = convFirstCond(sql, f);
    const pp = paymentPeriod(f);
    const staleDays = Math.max(1, Math.min(365, Number.parseInt(q.stale_days ?? '5', 10) || 5));
    const [[k], [stale], [avgWin], [avgAll], stages, icStatus, touchPoint, source, classRaw, reason, medium, campaign, staff, daily] = await Promise.all([
      sql<{ touches: number; leads: number; converted: number; converted_first: number; sf_converted: number; touches_of_converted: number }[]>`
        SELECT count(*)::int AS touches,
               count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted,
               count(DISTINCT t.lead_id) FILTER (WHERE ${convFirst})::int AS converted_first,
               count(DISTINCT t.lead_id) FILTER (WHERE t.lead_sf_is_converted)::int AS sf_converted,
               count(*) FILTER (WHERE ${conv})::int AS touches_of_converted
        FROM analytics.mv_touch_flat t WHERE ${w}`,
      // leads in the selection still in stage New, created more than N days ago and not touched in the last N days
      sql<{ stale_new: number; stale_new_untouched: number; new_total: number; stale_nc: number; stale_nc_untouched: number; nc_total: number }[]>`
        WITH n AS (
          SELECT t.lead_id, max(t.lead_stage) AS stage, max(t.lead_created_date) AS created, (SELECT max(t2.touch_at) FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = t.lead_id) AS last_touch
          FROM analytics.mv_touch_flat t WHERE ${w} AND t.lead_stage IN ('New', 'Not Connected') GROUP BY t.lead_id),
        s AS (SELECT stage, (created <= (now() AT TIME ZONE 'Asia/Kolkata')::date - ${staleDays}::int AND last_touch < now() - make_interval(days => ${staleDays})) AS stale,
                     (last_touch < created::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '1 day') AS untouched FROM n)
        SELECT count(*) FILTER (WHERE stage = 'New' AND stale)::int AS stale_new, count(*) FILTER (WHERE stage = 'New' AND stale AND untouched)::int AS stale_new_untouched, count(*) FILTER (WHERE stage = 'New')::int AS new_total,
               count(*) FILTER (WHERE stage = 'Not Connected' AND stale)::int AS stale_nc, count(*) FILTER (WHERE stage = 'Not Connected' AND stale AND untouched)::int AS stale_nc_untouched, count(*) FILTER (WHERE stage = 'Not Connected')::int AS nc_total
        FROM s`,
      // Tableau formula: AVG over touch rows (of leads with any valid payment) of the lead's all-time touch count
      sql<{ avg_rows: number | null; avg_leads: number | null; n_leads: number }[]>`
        SELECT avg(t.n_touches_all)::float8 AS avg_rows,
               (SELECT avg(x)::float8 FROM (SELECT max(n_touches_all) AS x FROM analytics.mv_touch_flat t WHERE ${w} AND t.converted GROUP BY lead_id) q) AS avg_leads,
               count(DISTINCT t.lead_id)::int AS n_leads
        FROM analytics.mv_touch_flat t WHERE ${w} AND t.converted`,
      sql<{ avg_rows: number | null; avg_leads: number | null; n_leads: number }[]>`
        SELECT avg(t.n_touches_all)::float8 AS avg_rows,
               (SELECT avg(x)::float8 FROM (SELECT max(n_touches_all) AS x FROM analytics.mv_touch_flat t WHERE ${wAll} AND t.converted GROUP BY lead_id) q) AS avg_leads,
               count(DISTINCT t.lead_id)::int AS n_leads
        FROM analytics.mv_touch_flat t WHERE ${wAll} AND t.converted`,
      sql<{ key: string; leads: number; converted: number }[]>`
        SELECT t.lead_stage AS key, count(DISTINCT t.lead_id)::int AS leads, count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted
        FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY leads DESC`,
      sql<{ key: string; leads: number; ics: number }[]>`
        SELECT btrim(ic.status__c) AS key, count(DISTINCT ic.lead_master__c)::int AS leads, count(*)::int AS ics
        FROM salesforce.interested_course__c ic
        WHERE NOT ic.isdeleted AND NULLIF(btrim(ic.status__c),'') IS NOT NULL
          AND ic.lead_master__c IN (SELECT DISTINCT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w})
        GROUP BY 1 ORDER BY leads DESC`,
      byDim(sql, w, 'touch_point', conv, convFirst), byDim(sql, w, 'source', conv, convFirst), byDim(sql, w, 'class_raw', conv, convFirst), byDim(sql, w, 'lm_reason', conv, convFirst),
      byDim(sql, w, 'medium', conv, convFirst), byDim(sql, w, 'campaign', conv, convFirst), byDim(sql, w, 'staff', conv, convFirst),
      sql<{ d: string; touches: number; leads: number; converted: number }[]>`
        SELECT t.touch_date::text AS d, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted
        FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      period: periods.current, payment_period: pp, basis: f.basis === 'created' ? 'created' : 'touch',
      kpis: {
        ...k,
        conv_rate: pct(k.converted, k.leads),
        touches_per_lead: k.leads ? Math.round((k.touches / k.leads) * 1000) / 1000 : null,
        avg_touches_alltime: avgAll?.avg_rows ?? null,
        avg_touches_alltime_per_lead: avgAll?.avg_leads ?? null,
        avg_touches_alltime_n: avgAll?.n_leads ?? 0,
        avg_touches_window: avgWin?.avg_rows ?? null,
        avg_touches_window_per_lead: avgWin?.avg_leads ?? null,
        avg_touches_window_n: avgWin?.n_leads ?? 0,
        stale_new: stale?.stale_new ?? 0, stale_new_untouched: stale?.stale_new_untouched ?? 0, new_total: stale?.new_total ?? 0, stale_days: staleDays,
        stale_nc: stale?.stale_nc ?? 0, stale_nc_untouched: stale?.stale_nc_untouched ?? 0, nc_total: stale?.nc_total ?? 0,
      },
      stages, ic_status: icStatus,
      touch_point: touchPoint, source, class_raw: classRaw, reason, medium, campaign, staff, daily,
      definitions: {
        leads: 'Tableau "Total leads" = COUNTD(Lead Master) over touches whose touch date (IST) is in the window. Deleted leads excluded; duplicates excluded unless toggled.',
        touches: 'Tableau "total lead touches" = COUNTD(Lead Touch) over touches in the window (IsDeleted = false).',
        converted: pp
          ? `Payment-date filter ON: leads in the selection that have a valid payment (payment_method 0, not deleted, is_success, payment_success) dated between ${pp.from} and ${pp.to}.`
          : 'Tableau "Converted" = distinct leads in the selection that have ANY valid payment (payment_method 0, not deleted, is_success, payment_success) dated on/after the touch day. Payment is matched on the normalised phone (last 10 digits); the workbook matches on the raw mobile string, which gives ~0.3% fewer.',
        leads_basis: f.basis === 'created' ? 'Main window = LEAD CREATED date: leads created in the range, with all their touches.' : 'Main window = TOUCH date: touches dated in the range.',
        converted_first: 'Brief definition: touched leads whose FIRST valid payment is on/after one of their touches in the window.',
        sf_converted: 'Touched leads with Salesforce Lead_Master__c.Is_Converted__c = true (reference).',
        avg_touches_alltime: 'Tableau "Avg Touches Before Conversion" (no date filter): average, over every touch row of leads with a valid payment, of the lead\'s all-time touch count. Row-weighted like the workbook; the workbook figure is additionally inflated by its Task / Interested-Course / payment joins, which duplicate rows.',
        avg_touches_window: 'Tableau "Avg Touches Before Conversion - Date wise": same as above restricted to touches in the window.',
        avg_per_lead: 'Per-lead variant (each converted lead counted once): the honest average number of touches a paying lead received.',
        reason: 'Tableau "Last Reason" reads Task.Reason__c (activities), which are not replicated (2.4 M rows). Shown instead: Lead_Master__c.LM_Reason__c of the touched leads.',
        stale_new: `Leads in the selection whose Lead Stage is still "New" although they were created more than ${staleDays} days ago and have had no touch in the last ${staleDays} days (any touch, in any month). "Never touched after creation" = their only touches are from the creation day itself. Only leads with at least one touch exist on this page.`,
        stale_nc: `Same rule for Lead Stage "Not Connected": created more than ${staleDays} days ago and no touch in the last ${staleDays} days.`,
        dim_converted: 'Per row: distinct converted leads (Tableau definition) having a touch of that value in the window. A lead can appear under several rows.',
      },
    };
  }),
);
