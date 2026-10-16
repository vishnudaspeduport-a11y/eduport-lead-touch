import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, pct, timedAll } from '../http';
import { LIST_KEYS, paymentPeriod, icCourseExpr, icCourseIn, type Filters, type Frag, type Period } from '../filters';
import { newLeadWhere } from './new_leads';

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
/** IC statuses that count as "parked": a later touch on the lead revives the interested course (Revised IC funnel) */
export const IC_PARKED = ['Not Interested', 'May Buy Later'];

export function convCond(sql: Sql, f: Filters): Frag {
  const pp = paymentPeriod(f);
  if (!pp) return sql`t.tab_converted`;
  return sql`EXISTS (SELECT 1 FROM analytics.v_payment_all hp WHERE hp.user_id = t.app_user_id AND hp.payment_method = 0 AND hp.deleted = false
                     AND hp.is_success = true AND hp.payment_success = true AND hp.payment_date BETWEEN ${pp.from} AND ${pp.to}
                     AND hp.payment_date >= t.touch_date)`;   // still on/after the touch day, as in the workbook
}
/** first valid payment on/after a touch (brief definition), within the payment window when it is on */
export function convFirstCond(sql: Sql, f: Filters): Frag {
  const pp = paymentPeriod(f);
  return pp ? sql`(t.converted AND t.is_pre_conversion AND t.converted_at BETWEEN ${pp.from} AND ${pp.to})` : sql`(t.converted AND t.is_pre_conversion)`;
}

/** main window: basis=created -> leads created in the range (all their touches); otherwise touches dated in the range */
/** `skip` = a list dim to ignore (option lists cascade from every OTHER filter) */
export function flatWhere(sql: Sql, f: Filters, p: Period | null, skip?: string): Frag {
  const c: Frag[] = [];
  if (p) c.push(f.basis === 'created' ? sql`t.lead_created_date BETWEEN ${p.from} AND ${p.to}` : sql`t.touch_date BETWEEN ${p.from} AND ${p.to}`);
  if (f.dups !== '1') c.push(sql`t.is_duplicate = false`);
  if (f.converted === '1') c.push(sql`${convCond(sql, f)}`);
  if (f.converted === '0') c.push(sql`NOT ${convCond(sql, f)}`);
  if (f.paid) c.push(f.paid === 'paid' ? sql`t.is_paid_lead = true` : sql`t.is_paid_lead IS NOT TRUE`);
  if (f.paid_touch) c.push(f.paid_touch === 'paid' ? sql`t.is_paid_touch = true` : sql`t.is_paid_touch IS NOT TRUE`);
  for (const k of LIST_KEYS) {
    const col = FLAT_COLS[k]; const vals = f[k];
    if (!vals?.length || k === skip) continue;
    if (!col && k !== 'call_reason' && k !== 'ic_course') continue;
    if (k === 'call_reason') {
      // reason recorded on the lead's LAST call (salesforce.lead_calls); '(no call)' = no call logged since May 2026,
      // '(no reason recorded)' = the last call exists but its Reason field is empty
      const real = vals.filter((v) => v !== '(no call)' && v !== '(no reason recorded)' && v !== '(null)');
      const noCall = vals.includes('(no call)'); const noReason = vals.includes('(no reason recorded)') || vals.includes('(null)');
      const parts: Frag[] = [];
      if (real.length) parts.push(sql`t.lead_id IN (SELECT c.lead_id FROM salesforce.lead_calls c WHERE c.last_reason IN ${sql(real)})`);
      if (noCall) parts.push(sql`NOT EXISTS (SELECT 1 FROM salesforce.lead_calls c WHERE c.lead_id = t.lead_id)`);
      if (noReason) parts.push(sql`EXISTS (SELECT 1 FROM salesforce.lead_calls c WHERE c.lead_id = t.lead_id AND c.last_reason IS NULL)`);
      c.push(parts.length === 1 ? parts[0]! : sql`(${parts.reduce((acc, p) => sql`${acc} OR ${p}`)})`);
      continue;
    }
    if (k === 'ic_course') {
      // any interested course of the lead with one of these course names
      const real = vals.filter((v) => v !== '(null)');
      if (real.length) c.push(icCourseIn(sql, 't', real));
      continue;
    }
    if (k === 'ic_status') {
      // same source as the IC-status funnel: any interested course of the lead in one of these statuses
      const real = vals.filter((v) => v !== '(null)');
      if (real.length) c.push(sql`t.lead_id IN (SELECT ic.lead_master__c FROM salesforce.interested_course__c ic WHERE NOT ic.isdeleted AND btrim(ic.status__c) IN ${sql(real)})`);
      continue;
    }
    if (!col) continue;
    const hasNull = vals.includes('(null)'); const real = vals.filter((v) => v !== '(null)');
    const ref = sql`t.${sql(col)}`;
    if (hasNull && real.length) c.push(sql`(${ref} IN ${sql(real)} OR ${ref} IS NULL)`);
    else if (hasNull) c.push(sql`${ref} IS NULL`);
    else c.push(sql`${ref} IN ${sql(real)}`);
  }
  return c.reduce((a, x) => sql`${a} AND ${x}`, sql`true`);
}

/** turnaround-time band for a day count (date - date) */
export function tatBucket(sql: Sql, days: Frag): Frag {
  return sql`CASE WHEN ${days} IS NULL THEN 'no prior touch' WHEN ${days} < 0 THEN 'before lead created' WHEN ${days} = 0 THEN 'same day' WHEN ${days} <= 3 THEN '1–3 d' WHEN ${days} <= 7 THEN '4–7 d'
                WHEN ${days} <= 14 THEN '8–14 d' WHEN ${days} <= 30 THEN '15–30 d' ELSE '31+ d' END`;
}
export const TAT_BUCKETS = ['before lead created', 'same day', '1–3 d', '4–7 d', '8–14 d', '15–30 d', '31+ d', 'no prior touch'];

export interface DimRow { key: string; touches: number; leads: number; converted: number; converted_first: number; conv_rate?: number | null }

/** `keep` = the values selected in the filter bar: always returned (first), even when they rank below the row limit */
// every value is returned (2000 is only a safety cap): the cards search and total over all rows, and a rare value must still be findable
async function byDim(sql: Sql, w: Frag, col: string, conv: Frag, convFirst: Frag, limit = 2000, keep: string[] = []): Promise<DimRow[]> {
  const keepFirst = keep.length ? sql`(COALESCE(t.${sql(col)}::text, '(null)') IN ${sql(keep)}) DESC,` : sql``;
  const rows = await sql<DimRow[]>`
    SELECT COALESCE(t.${sql(col)}::text, '(null)') AS key, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
           count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted,
           count(DISTINCT t.lead_id) FILTER (WHERE ${convFirst})::int AS converted_first
    FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY ${keepFirst} touches DESC LIMIT ${limit + keep.length}`;
  return rows.map((r) => ({ ...r, conv_rate: pct(r.converted, r.leads) }));
}

overview.get('/overview', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const w = flatWhere(sql, f, periods.current);
    const wAll = flatWhere(sql, f, null);
    // a card never filters itself: its rows stay visible (highlighted) so more of them can be selected
    const wx = (skip: string) => flatWhere(sql, f, periods.current, skip);
    const conv = convCond(sql, f); const convFirst = convFirstCond(sql, f);
    const pp = paymentPeriod(f);
    const feeWin = pp ?? periods.current;   // payments counted for the fee KPIs: the payment-date window when it is on, else the main date range
    const staleDays = Math.max(1, Math.min(365, Number.parseInt(q.stale_days ?? '5', 10) || 5));
    const QN = ['kpis', 'stale', 'avg_window', 'avg_alltime', 'stages', 'ic_status', 'touch_point', 'source', 'class_raw', 'call_reason', 'medium', 'campaign', 'staff', 'daily', 'stage_react', 'lm_reason', 'new_leads', 'stages_revised', 'tat', 'leads_union', 'fees', 'ic_status_revised', 'ic_course'];
    const [[k], [stale], [avgWin], [avgAll], stages, icStatus, touchPoint, source, classRaw, reason, medium, campaign, staff, daily, reactRows, lmReason, [newLeads], stagesRevised, tatRows, [leadsUnion], [fees], icStatusRevised, icCourse] = await timedAll(QN, [
      sql<{ touches: number; leads: number; converted: number; converted_first: number; sf_converted: number; stage_conv_total: number; stage_conv_unpaid: number; paid_other_stage: number; touches_of_converted: number }[]>`
        SELECT count(*)::int AS touches,
               count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted,
               count(DISTINCT t.lead_id) FILTER (WHERE ${convFirst})::int AS converted_first,
               count(DISTINCT t.lead_id) FILTER (WHERE t.lead_sf_is_converted)::int AS sf_converted,
               count(DISTINCT t.lead_id) FILTER (WHERE t.lead_stage = 'Converted')::int AS stage_conv_total,
               count(DISTINCT t.lead_id) FILTER (WHERE t.lead_stage = 'Converted' AND NOT t.converted)::int AS stage_conv_unpaid,
               count(DISTINCT t.lead_id) FILTER (WHERE ${conv} AND t.lead_stage IS DISTINCT FROM 'Converted')::int AS paid_other_stage,
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
        FROM analytics.mv_touch_flat t WHERE ${wx('lead_stage')} GROUP BY 1 ORDER BY leads DESC`,
      sql<{ key: string; leads: number; ics: number }[]>`
        SELECT btrim(ic.status__c) AS key, count(DISTINCT ic.lead_master__c)::int AS leads, count(*)::int AS ics
        FROM (SELECT DISTINCT t.lead_id FROM analytics.mv_touch_flat t WHERE ${wx('ic_status')}) k
        JOIN salesforce.interested_course__c ic ON ic.lead_master__c = k.lead_id AND ic.isdeleted = false
        WHERE NULLIF(btrim(ic.status__c),'') IS NOT NULL
        GROUP BY 1 ORDER BY leads DESC`,
      byDim(sql, wx('touch_point'), 'touch_point', conv, convFirst, 2000, f.touch_point ?? []), byDim(sql, wx('source'), 'source', conv, convFirst, 2000, f.source ?? []), byDim(sql, wx('class_raw'), 'class_raw', conv, convFirst, 2000, f.class_raw ?? []), sql<DimRow[]>`
        SELECT CASE WHEN c.lead_id IS NULL THEN '(no call)' WHEN c.last_reason IS NULL THEN '(no reason recorded)' ELSE c.last_reason END AS key, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted, count(DISTINCT t.lead_id) FILTER (WHERE ${convFirst})::int AS converted_first
        FROM analytics.mv_touch_flat t LEFT JOIN salesforce.lead_calls c ON c.lead_id = t.lead_id
        WHERE ${wx('call_reason')} GROUP BY 1 ORDER BY leads DESC LIMIT 500`,
      byDim(sql, wx('medium'), 'medium', conv, convFirst, 2000, f.medium ?? []), byDim(sql, wx('campaign'), 'campaign', conv, convFirst, 2000, f.campaign ?? []), byDim(sql, wx('staff'), 'staff', conv, convFirst, 2000, f.staff ?? []),
      sql<{ d: string; touches: number; leads: number; converted: number }[]>`
        SELECT t.touch_date::text AS d, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE ${conv})::int AS converted
        FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY 1`,
      // leads parked in a closed stage that were touched AGAIN after entering it (stage moment from the Salesforce history log)
      sql<{ stage: string; total: number; reactivated: number }[]>`
        WITH r AS (
          SELECT t.lead_id, max(t.lead_stage) AS stage, max(t.lead_created_date)::timestamptz AS created,
                 (SELECT max(t2.touch_at) FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = t.lead_id) AS last_touch
          FROM analytics.mv_touch_flat t WHERE ${w} AND t.lead_stage IN ('Not Willing Now', 'Disqualified', 'Not Connected', 'P2 Completed') GROUP BY t.lead_id)
        SELECT stage, count(*)::int AS total, count(*) FILTER (WHERE last_touch > analytics.stage_since(lead_id, stage, created))::int AS reactivated
        FROM r GROUP BY stage ORDER BY reactivated DESC`,
      byDim(sql, wx('lm_reason'), 'lm_reason', conv, convFirst, 2000, f.lm_reason ?? []),
      // New leads: every Salesforce lead created inside the window (most have no touch yet, so this reads the lead view, not the touch table).
      // Keep the touched test as a correlated EXISTS (index probe, ~0.1 s): `lead_id IN (SELECT ...)` inside the FILTER ran row by row (150 s).
      sql<{ new_leads: number; new_leads_touched: number }[]>`
        SELECT count(*)::int AS new_leads,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics.mv_touch_flat t WHERE t.lead_id = l.lead_id))::int AS new_leads_touched
        FROM analytics.mv_lead_lite l WHERE ${newLeadWhere(sql, f, periods.current)}`,   // narrow materialized copy (sql/035): the count scans a fraction of the lead table
      // Revised funnel: a lead in Connected, Not Willing Now, Disqualified, Not Connected or P2 Completed that was touched AFTER the stage change
      // counts under New (it is active again); every other lead keeps its stage. Stage moment = the Salesforce field-history row of the latest
      // change into the current stage (salesforce.lead_stage, joined once instead of calling analytics.stage_since per lead), else the creation
      // date / 1 March 2026 - the same rule as stage_since.
      sql<{ key: string; leads: number; converted: number; revived: number }[]>`
        WITH r AS (
          SELECT t.lead_id, max(t.lead_stage) AS stage, max(t.lead_created_date)::timestamptz AS created, bool_or(${conv}) AS converted,
                 (SELECT max(t2.touch_at) FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = t.lead_id) AS last_touch
          FROM analytics.mv_touch_flat t WHERE ${wx('lead_stage')} GROUP BY t.lead_id),
        x AS (
          SELECT r.stage, r.converted,
                 CASE WHEN r.stage IN ('Connected', 'Not Willing Now', 'Disqualified', 'Not Connected', 'P2 Completed')
                       AND r.last_touch > COALESCE(ls.changed_at, GREATEST(r.created, '2026-03-01 00:00:00+00'::timestamptz))
                      THEN 'New' ELSE r.stage END AS key
          FROM r LEFT JOIN salesforce.lead_stage ls ON ls.lead_id = r.lead_id AND ls.stage = r.stage)
        SELECT key, count(*)::int AS leads, count(*) FILTER (WHERE converted)::int AS converted, count(*) FILTER (WHERE key IS DISTINCT FROM stage)::int AS revived
        FROM x GROUP BY key ORDER BY leads DESC`,
      // Turnaround time of the converted leads in the selection: lead created -> first valid payment day, and latest touch on/before that day -> payment day
      sql<{ kind: string; key: string; leads: number; avg_days: number | null; median_days: number | null }[]>`
        WITH c AS (
          SELECT t.lead_id, max(t.converted_at) AS paid, max(t.lead_created_date) AS created,
                 (SELECT max(t2.touch_date) FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = t.lead_id AND t2.is_pre_conversion) AS last_touch
          FROM analytics.mv_touch_flat t WHERE ${w} AND ${conv} AND t.converted_at IS NOT NULL GROUP BY t.lead_id),
        d AS (SELECT 'created' AS kind, (paid - created)::int AS days FROM c
              UNION ALL SELECT 'touch', (paid - last_touch)::int FROM c)
        SELECT kind, ${tatBucket(sql, sql`days`)} AS key, count(*)::int AS leads, NULL::float8 AS avg_days, NULL::float8 AS median_days FROM d GROUP BY 1, 2
        UNION ALL
        SELECT kind, '_all', count(*)::int, avg(days)::float8, percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::float8 FROM d GROUP BY 1`,
      // Total leads on the lead-created basis: leads created in the window OR touched in the window
      f.basis === 'created'
        ? sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analytics.mv_lead_lite l WHERE ${newLeadWhere(sql, f, periods.current, { scope: 'union' })}`
        : Promise.resolve([{ n: 0 }]),
      // Proposed fee / fee received: valid payments (payment_method 0) dated inside the window, made by the app accounts of the leads in the
      // selection (own phone or alternative number). Proposed fee = fee - discount of the enrollments those payments belong to, each once.
      sql<{ fee_payers: number; fee_payments: number; fee_received: number; proposed_fee: number; fee_enrollments: number; fee_enrollments_unknown: number }[]>`
        WITH lk AS (SELECT DISTINCT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w}),
        -- leads of the selection -> their phone keys -> every app / Ujra account on those numbers (mv_user_phone, indexed) -> valid payments in the window
        pk AS (SELECT DISTINCT analytics.phone_key(m.mobile_number__c) AS pk FROM lk JOIN salesforce.lead_master__c m ON m.id = lk.lead_id WHERE analytics.phone_key_valid(m.mobile_number__c)),
        ok AS (SELECT DISTINCT up.user_id FROM pk JOIN analytics.mv_user_phone up ON up.phone_key = pk.pk),
        pay AS (
          SELECT hp.id, hp.user_id, hp.amount, hp.enrollment_id, hp.enrollment_fee, hp.enrollment_discount
          FROM ok JOIN analytics.v_payment_all hp ON hp.user_id = ok.user_id
          WHERE hp.payment_method = 0 AND hp.deleted = false AND hp.is_success = true AND hp.payment_success = true
            AND hp.payment_date BETWEEN ${feeWin.from} AND ${feeWin.to}),
        enr AS (
          SELECT DISTINCT ON (COALESCE(enrollment_id::text, 'p' || id::text)) enrollment_id, enrollment_fee, enrollment_discount
          FROM pay ORDER BY COALESCE(enrollment_id::text, 'p' || id::text))
        SELECT (SELECT count(DISTINCT user_id) FROM pay)::int AS fee_payers, (SELECT count(*) FROM pay)::int AS fee_payments,
               (SELECT COALESCE(sum(amount), 0) FROM pay)::float8 AS fee_received,
               (SELECT COALESCE(sum(enrollment_fee - COALESCE(enrollment_discount, 0)), 0) FROM enr)::float8 AS proposed_fee,
               (SELECT count(*) FROM enr WHERE enrollment_fee IS NOT NULL)::int AS fee_enrollments,
               (SELECT count(*) FROM enr WHERE enrollment_fee IS NULL)::int AS fee_enrollments_unknown`,
      // Revised IC funnel: an interested course in Not Interested / May Buy Later whose lead was touched AFTER the status change counts as New
      // (the lead is active again); every other IC keeps its status. Status moment = latest field-history change into the current status
      // (salesforce.ic_status), else the IC's creation date / 1 March 2026.
      sql<{ key: string; leads: number; ics: number; revived: number }[]>`
        WITH lk AS (SELECT DISTINCT t.lead_id FROM analytics.mv_touch_flat t WHERE ${wx('ic_status')}),
        lt AS (SELECT lk.lead_id, (SELECT max(t2.touch_at) FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = lk.lead_id) AS last_touch FROM lk),
        x AS (
          SELECT ic.lead_master__c AS lead_id, btrim(ic.status__c) AS status,
                 CASE WHEN btrim(ic.status__c) IN ${sql(IC_PARKED)}
                       AND lt.last_touch > COALESCE(h.changed_at, GREATEST(ic.createddate, '2026-03-01 00:00:00+00'::timestamptz))
                      THEN 'New' ELSE btrim(ic.status__c) END AS key
          FROM lt JOIN salesforce.interested_course__c ic ON ic.lead_master__c = lt.lead_id AND ic.isdeleted = false
          LEFT JOIN salesforce.ic_status h ON h.ic_id = ic.id AND h.status = btrim(ic.status__c)
          WHERE NULLIF(btrim(ic.status__c), '') IS NOT NULL)
        SELECT key, count(DISTINCT lead_id)::int AS leads, count(*)::int AS ics, count(DISTINCT lead_id) FILTER (WHERE key IS DISTINCT FROM status)::int AS revived
        FROM x GROUP BY key ORDER BY leads DESC`,
      // Interested course: the leads of the selection by the course name on their Interested Course records (a lead with several appears under each)
      sql<DimRow[]>`
        WITH lk AS (
          SELECT t.lead_id, count(*)::int AS touches, bool_or(${conv}) AS conv, bool_or(${convFirst}) AS conv_first
          FROM analytics.mv_touch_flat t WHERE ${wx('ic_course')} GROUP BY t.lead_id)
        SELECT ${icCourseExpr(sql)} AS key, sum(lk.touches)::int AS touches, count(DISTINCT lk.lead_id)::int AS leads,
               count(DISTINCT lk.lead_id) FILTER (WHERE lk.conv)::int AS converted, count(DISTINCT lk.lead_id) FILTER (WHERE lk.conv_first)::int AS converted_first
        FROM lk JOIN salesforce.interested_course__c ic ON ic.lead_master__c = lk.lead_id AND ic.isdeleted = false
        LEFT JOIN salesforce.course__c cr ON cr.id = ic.course__c
        WHERE ${icCourseExpr(sql)} IS NOT NULL
        GROUP BY 1 ORDER BY leads DESC LIMIT 2000`,
    ]);
    const tatShape = (kind: 'created' | 'touch') => {
      const all = tatRows.find((r) => r.kind === kind && r.key === '_all');
      const buckets = TAT_BUCKETS.map((key) => ({ key, leads: tatRows.find((r) => r.kind === kind && r.key === key)?.leads ?? 0 }))
        .filter((b) => (b.key !== 'before lead created' && b.key !== 'no prior touch') || b.leads > 0);
      return { leads: all?.leads ?? 0, avg_days: all?.avg_days ?? null, median_days: all?.median_days ?? null, buckets };
    };
    const leadsAll = f.basis === 'created' ? (leadsUnion?.n ?? k.leads) : k.leads;
    return {
      period: periods.current, payment_period: pp, basis: f.basis === 'created' ? 'created' : 'touch',
      kpis: {
        ...k,
        // Lead-created basis: Total leads = leads created in the window (touched or not) + leads touched in the window; New leads = the created ones.
        // Touch-date basis: leads with a touch dated in the window. leads_touched = leads of the selection that have a touch (base of the rates).
        leads: leadsAll, leads_touched: k.leads,
        stage_react: reactRows.reduce((a, r) => a + r.reactivated, 0),
        stage_react_total: reactRows.reduce((a, r) => a + r.total, 0),
        stage_react_by: reactRows,
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
        new_leads: newLeads?.new_leads ?? 0, new_leads_touched: newLeads?.new_leads_touched ?? 0,
        ...(fees ?? { fee_payers: 0, fee_payments: 0, fee_received: 0, proposed_fee: 0, fee_enrollments: 0, fee_enrollments_unknown: 0 }), fee_window: feeWin,
      },
      stages, stages_revised: stagesRevised, ic_status: icStatus, ic_status_revised: icStatusRevised, ic_course: icCourse.map((r) => ({ ...r, conv_rate: pct(r.converted, r.leads) })), tat: { created: tatShape('created'), touch: tatShape('touch') },
      touch_point: touchPoint, source, class_raw: classRaw, reason, lm_reason: lmReason, medium, campaign, staff, daily,
      definitions: {
        leads: f.basis === 'created'
          ? 'Leads created (IST) inside the window, touched or not, PLUS older leads that received a touch dated inside the window. New leads is the created part, so it is always a subset of this figure. Deleted leads are excluded; duplicate leads are excluded unless toggled on. The rates, charts and tables below stay touch-level: they cover the leads created in the window that have a touch.'
          : 'Distinct leads that have at least one touch dated (IST) inside the window. Deleted leads are excluded; duplicate leads are excluded unless toggled on.',
        touches: 'Number of distinct touch records dated inside the window (app installs, webinar registrations, forms, ads, community joins). Deleted touches are excluded. One lead can have several touches.',
        converted: pp
          ? `Payment-date filter ON: leads in the selection that have a valid payment (payment_method 0, not deleted, is_success, payment_success) dated between ${pp.from} and ${pp.to}.`
          : 'Distinct leads in the selection that have ANY valid payment (payment_method 0, not deleted, is_success, payment_success) dated on/after one of their touch days. Payments are matched to leads on the phone number (last 10 digits): the own phone of the paying app account, or its alternative number.',
        proposed_fee: 'Proposed fee = fee minus discount of the enrollments that received a payment inside the date range (the payment-date window when it is switched on), each enrollment counted once. Only payments of the app accounts linked to the leads in the selection (own phone or alternative number), valid and payment_method 0. It is the agreed price, so it is larger than the fee received while instalments are still open.',
        fee_received: 'Fee received = sum of the payment amounts dated inside the same date range, for the same leads and accounts (valid payments, payment_method 0).',
        tat: 'Turnaround time of the converted leads in the selection (Total converted rule), in calendar days. "Lead created → paid": from the day the lead was created to the day of its FIRST valid payment; "before lead created" = the phone already had a payment before the lead existed. "Last touch → paid": from the latest lead touch on or before that payment day to the payment day; "no prior touch" = the first payment came before any touch (the lead counts as converted because a later payment followed a touch). Median = half the leads were faster. Click a band to list those leads.',
        ic_course: 'The leads of the selection grouped by the course name on their Salesforce Interested Course records (interest, not purchase). A lead with several interested courses appears under each. Total leads = distinct leads with that course; touches = those leads\' touches in the window; converted = the dashboard conversion rule. Click a row to filter every page by that course; the filter bar has the same list under "Interested course". What was actually bought is on the Converted page (Purchased course).',
        ic_status_revised: 'Same leads and interested courses as the IC-status funnel, but an interested course in Not Interested or May Buy Later whose lead was touched again AFTER the status change counts as New (the lead is active again). Follow Up is an active status, so a later touch is expected there and it is not moved. The status moment is the latest Salesforce field-history change into the current status (history from 1 March 2026); without one, the later of the IC creation date and 1 March 2026. "moved to New" = leads moved by this rule.',
        stages_revised: 'Same leads as the Lead funnel, but a lead in Connected, Not Willing Now, Disqualified, Not Connected or P2 Completed that received a lead touch AFTER it entered that stage is counted under New (it is active again). Leads with no touch after the stage change stay in their stage. The stage moment comes from the Salesforce field-history log; leads with no logged change since 1 March 2026 use their creation date, or 1 March 2026 if older.',
        new_leads: 'Salesforce leads created (IST) inside the date range, whether or not they have a touch yet - the only figure on this page that includes leads without a touch. Deleted leads are excluded; duplicates are excluded unless toggled on. Lead filters (class, lead source, stage, LM reason, owner …) apply to the lead itself; touch filters (touch point, source, campaign, medium, staff) keep only leads with at least one such touch on any date. "With a touch" = at least one lead touch on record, any date.',
        leads_basis: f.basis === 'created' ? 'Main window = LEAD CREATED date: leads created in the range (touched or not), with all their touches.' : 'Main window = TOUCH date: touches dated in the range.',
        converted_first: 'Brief definition: touched leads whose FIRST valid payment is on/after one of their touches in the window.',
        sf_converted: 'Touched leads with Salesforce Lead_Master__c.Is_Converted__c = true (reference).',
        stage_react: 'Leads in the selection whose current stage is Not Willing Now, Disqualified, Not Connected or P2 Completed AND that received at least one lead touch AFTER entering that stage. The stage moment comes from the Salesforce field-history log (latest change into the current stage); leads with no logged change since 1 March 2026 use their creation date, or 1 March 2026 if older.',
        stage_conv_unpaid: 'Leads whose Salesforce Lead Stage is "Converted" but with NO valid payment on their phone (any date): marked converted without a purchase.',
        paid_other_stage: 'Leads counted in Total converted (valid payment on/after a touch, inside the payment window when it is on) whose Lead Stage is NOT "Converted": paid, but the stage was never updated.',
        avg_touches_alltime: 'Average number of touches a paying lead received, no date filter. The headline is weighted by touch rows (a lead with 6 touches counts 6 times), the caption shows the plain per-lead average.',
        avg_touches_window: 'Same as the all-time average, restricted to touches dated inside the window.',
        avg_per_lead: 'Per-lead variant (each converted lead counted once): the honest average number of touches a paying lead received.',
        lm_reason: 'Lead_Master__c.LM_Reason__c: the reason stored on the lead record itself (set by the salesperson on the lead), one value per lead.',
        reason: 'The Reason recorded on the lead\'s LAST call (Salesforce call log, calls since May 2026). "(no call)" = no call logged in that period; "(no reason recorded)" = the last call was logged without a Reason. The lead\'s own LM Reason field is a separate card and filter.',
        stale_new: `Leads in the selection whose Lead Stage is still "New" although they were created more than ${staleDays} days ago and have had no touch in the last ${staleDays} days (any touch, in any month). "Never touched after creation" = their only touches are from the creation day itself. Only leads with at least one touch exist on this page.`,
        stale_nc: `Same rule for Lead Stage "Not Connected": created more than ${staleDays} days ago and no touch in the last ${staleDays} days.`,
        dim_converted: 'Per row: distinct converted leads having a touch of that value in the window. A lead can appear under several rows.',
      },
    };
  }),
);
