import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import { LIST_KEYS, type Filters, type Frag, type Period } from '../filters';

/**
 * GET /api/overview  - everything on the Tableau-style Overview in one call.
 * Grain = TOUCH (like the workbook): the window is on touch date, "Total leads" = distinct leads
 * with a touch in the window, and every per-dimension "Converted" = distinct converted leads
 * having a touch of that dimension in the window.
 * Reads only analytics.mv_touch_flat (+ interested courses for the IC funnel).
 */
export const overview = new Hono<AppEnv>();

/** filter key -> column on mv_touch_flat */
const FLAT_COLS: Partial<Record<(typeof LIST_KEYS)[number], string>> = {
  lead_source: 'lead_source', lead_stage: 'lead_stage', class_group: 'class_group', class_raw: 'class_raw', district: 'district', city: 'city',
  priority: 'priority', lead_type: 'lead_type', owner: 'owner_name', ic_status: 'best_ic_status', app_tier: 'app_engagement_tier',
  campaign_quality: 'campaign_quality', lm_reason: 'lm_reason', source: 'source', medium: 'medium', touch_point: 'touch_point',
  campaign: 'campaign', ad_set: 'adset_name', ad_name: 'ad_name', staff: 'staff', gap_bucket: 'gap_bucket',
};

function flatWhere(sql: Sql, f: Filters, p: Period): Frag {
  const c: Frag[] = [sql`t.touch_date BETWEEN ${p.from} AND ${p.to}`];
  if (f.dups !== '1') c.push(sql`t.is_duplicate = false`);
  if (f.converted === '1') c.push(sql`t.converted = true`);
  if (f.converted === '0') c.push(sql`t.converted = false`);
  if (f.paid) c.push(f.paid === 'paid' ? sql`t.is_paid_lead = true` : sql`t.is_paid_lead IS NOT TRUE`);
  if (f.paid_touch) c.push(f.paid_touch === 'paid' ? sql`t.is_paid_touch = true` : sql`t.is_paid_touch IS NOT TRUE`);
  for (const k of LIST_KEYS) {
    const col = FLAT_COLS[k]; const vals = f[k];
    if (!col || !vals?.length) continue;
    const hasNull = vals.includes('(null)'); const real = vals.filter((v) => v !== '(null)');
    const ref = sql`t.${sql(col)}`;
    if (hasNull && real.length) c.push(sql`(${ref} IN ${sql(real)} OR ${ref} IS NULL)`);
    else if (hasNull) c.push(sql`${ref} IS NULL`);
    else c.push(sql`${ref} IN ${sql(real)}`);
  }
  return c.reduce((a, x) => sql`${a} AND ${x}`, sql`true`);
}

interface DimRow { key: string; touches: number; leads: number; converted: number; converted_attr: number; revenue: number }

async function byDim(sql: Sql, w: Frag, col: string, limit = 30): Promise<DimRow[]> {
  const rows = await sql<DimRow[]>`
    SELECT COALESCE(t.${sql(col)}::text, '(null)') AS key, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
           count(DISTINCT t.lead_id) FILTER (WHERE t.converted)::int AS converted,
           count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted_attr,
           COALESCE(sum(t.credit_linear * t.revenue),0)::float8 AS revenue
    FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY touches DESC LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, conv_rate: pct(r.converted, r.leads) })) as DimRow[];
}

overview.get('/overview', (c) =>
  handle(c, async ({ sql, f, periods }) => {
    const w = flatWhere(sql, f, periods.current);
    const [[k], [avgPre], stages, icStatus, touchPoint, source, classRaw, reason, medium, campaign, staff, daily] = await Promise.all([
      sql<{ touches: number; leads: number; converted: number; converted_in_window: number; converted_attr: number; sf_converted: number; touches_of_converted: number; revenue: number }[]>`
        SELECT count(*)::int AS touches,
               count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE t.converted)::int AS converted,
               count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.converted_at BETWEEN ${periods.current.from} AND ${periods.current.to})::int AS converted_in_window,
               count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted_attr,
               count(DISTINCT t.lead_id) FILTER (WHERE t.lead_sf_is_converted)::int AS sf_converted,
               count(*) FILTER (WHERE t.converted)::int AS touches_of_converted,
               COALESCE(sum(t.credit_linear * t.revenue),0)::float8 AS revenue
        FROM analytics.mv_touch_flat t WHERE ${w}`,
      sql<{ avg_pre_touches: number | null; avg_all_touches: number | null }[]>`
        SELECT avg(n_pre)::float8 AS avg_pre_touches, avg(n_all)::float8 AS avg_all_touches FROM (
          SELECT t.lead_id, max(t.n_pre_touches) AS n_pre, max(t.n_touches_all) AS n_all
          FROM analytics.mv_touch_flat t WHERE ${w} AND t.converted GROUP BY t.lead_id) x`,
      sql<{ key: string; leads: number; converted: number }[]>`
        SELECT t.lead_stage AS key, count(DISTINCT t.lead_id)::int AS leads, count(DISTINCT t.lead_id) FILTER (WHERE t.converted)::int AS converted
        FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY leads DESC`,
      sql<{ key: string; leads: number; ics: number }[]>`
        SELECT COALESCE(NULLIF(btrim(ic.status__c),''),'(blank)') AS key, count(DISTINCT ic.lead_master__c)::int AS leads, count(*)::int AS ics
        FROM salesforce.interested_course__c ic
        WHERE NOT ic.isdeleted AND ic.lead_master__c IN (SELECT DISTINCT t.lead_id FROM analytics.mv_touch_flat t WHERE ${w})
        GROUP BY 1 ORDER BY leads DESC`,
      byDim(sql, w, 'touch_point'), byDim(sql, w, 'source'), byDim(sql, w, 'class_raw'), byDim(sql, w, 'lm_reason'),
      byDim(sql, w, 'medium'), byDim(sql, w, 'campaign'), byDim(sql, w, 'staff'),
      sql<{ d: string; touches: number; leads: number; converted: number }[]>`
        SELECT t.touch_date::text AS d, count(*)::int AS touches, count(DISTINCT t.lead_id)::int AS leads,
               count(DISTINCT t.lead_id) FILTER (WHERE t.converted)::int AS converted
        FROM analytics.mv_touch_flat t WHERE ${w} GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      period: periods.current,
      kpis: {
        ...k,
        conv_rate: pct(k.converted, k.leads),
        touches_per_lead: k.leads ? Math.round((k.touches / k.leads) * 1000) / 1000 : null,
        touches_per_converted_lead: k.converted ? Math.round((k.touches_of_converted / k.converted) * 1000) / 1000 : null,
        avg_pre_touches_converted: avgPre?.avg_pre_touches ?? null,
        avg_all_touches_converted: avgPre?.avg_all_touches ?? null,
      },
      stages, ic_status: icStatus,
      touch_point: touchPoint, source, class_raw: classRaw, reason, medium, campaign, staff, daily,
      definitions: {
        leads: 'Distinct leads with at least one touch in the window (touch date, IST). Deleted leads excluded; duplicates excluded unless toggled.',
        touches: 'Lead_Touch__c rows with touch date in the window (IsDeleted = false, lead exists).',
        converted: 'Distinct touched leads with a valid payment on record at any time (payment_method 0, not deleted, success flags, user not deleted), matched on the normalised phone.',
        converted_in_window: 'Same, but the first valid payment date falls inside the window.',
        converted_attr: 'Touched leads whose payment came on/after at least one of their touches (touch-attributable).',
        sf_converted: 'Touched leads with Salesforce Is_Converted__c = true (reference).',
        touches_per_converted_lead: 'Touches in the window of converted leads / converted leads.',
        avg_pre_touches_converted: 'Average number of touches on/before the payment date per converted lead (all time, not just the window).',
        avg_all_touches_converted: 'Average number of touches per converted lead (all time).',
        dim_converted: 'Per row: distinct converted leads that have a touch of that value in the window. A lead can appear under several rows.',
      },
    };
  }),
);
