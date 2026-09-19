import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, pct } from '../http';
import { leadWhere } from '../filters';

export const funnel = new Hono<AppEnv>();

const STAGE_ORDER = ['New', 'Not Connected', 'Connected', 'P2 Completed', 'Not Willing Now', 'Disqualified', 'Converted'];

/** GET /api/funnel : lead stages, IC status funnel, discount leakage, IC-count vs conversion, time in stage, drop-off reasons */
funnel.get('/funnel', (c) =>
  handle(c, async ({ sql, f, periods }) => {
    const lw = leadWhere(sql, f, periods.current);
    const [stages, icStatus, [leak], icCount, lmReasons, taskReasons, timeInStage] = await Promise.all([
      sql<{ stage: string; leads: number; converted: number; revenue: number; avg_touches: number | null; open_leads: number }[]>`
        SELECT l.lead_stage AS stage, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted,
               COALESCE(sum(l.revenue),0)::float8 AS revenue, avg(l.valid_touches)::float8 AS avg_touches,
               count(*) FILTER (WHERE l.is_open)::int AS open_leads
        FROM analytics.mv_lead_base l WHERE ${lw} GROUP BY 1`,
      sql<{ status: string; ics: number; leads: number; enrolled: number; fees_offered: number; converted_leads: number }[]>`
        SELECT ic.status, count(*)::int AS ics, count(DISTINCT ic.lead_id)::int AS leads,
               count(*) FILTER (WHERE ic.is_enrolled)::int AS enrolled,
               COALESCE(sum(ic.fees_offered),0)::float8 AS fees_offered,
               count(DISTINCT ic.lead_id) FILTER (WHERE l.converted)::int AS converted_leads
        FROM analytics.mv_ic_base ic JOIN analytics.mv_lead_base l ON l.lead_id = ic.lead_id
        WHERE ${lw} GROUP BY 1 ORDER BY ics DESC`,
      sql<{ leads: number; offered: number; realized: number; leads_with_offer: number }[]>`
        WITH x AS (
          SELECT l.lead_id, max(ic.fees_offered) AS offered, l.revenue
          FROM analytics.mv_lead_base l JOIN analytics.mv_ic_base ic ON ic.lead_id = l.lead_id
          WHERE ${lw} AND l.converted GROUP BY l.lead_id, l.revenue)
        SELECT count(*)::int AS leads, COALESCE(sum(offered),0)::float8 AS offered, COALESCE(sum(revenue),0)::float8 AS realized,
               count(*) FILTER (WHERE offered > 0)::int AS leads_with_offer FROM x`,
      sql<{ ic_bucket: string; leads: number; converted: number }[]>`
        SELECT CASE WHEN COALESCE(l.ic_count,0) >= 4 THEN '4+' ELSE COALESCE(l.ic_count,0)::int::text END AS ic_bucket,
               count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted
        FROM analytics.mv_lead_base l WHERE ${lw} GROUP BY 1 ORDER BY 1`,
      sql<{ reason: string; leads: number; converted: number }[]>`
        SELECT COALESCE(l.lm_reason,'(none)') AS reason, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted
        FROM analytics.mv_lead_base l WHERE ${lw} GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
      sql<{ reason: string; leads: number; converted: number }[]>`
        SELECT COALESCE(c.last_reason,'(none)') AS reason, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted
        FROM analytics.mv_lead_base l JOIN analytics.mv_lead_calls c ON c.lead_id = l.lead_id
        WHERE ${lw} GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
      sql<{ stage: string; leads: number; median_days: number | null; avg_days: number | null }[]>`
        SELECT l.lead_stage AS stage, count(*)::int AS leads,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY (COALESCE(l.converted_at, current_date) - l.created_date)))::float8 AS median_days,
               avg(COALESCE(l.converted_at, current_date) - l.created_date)::float8 AS avg_days
        FROM analytics.mv_lead_base l WHERE ${lw} GROUP BY 1`,
    ]);
    const order = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 99 : i; };
    return {
      stages: stages.map((s) => ({ ...s, conv_rate: pct(s.converted, s.leads) })).sort((a, b) => order(a.stage) - order(b.stage)),
      ic_status: icStatus,
      discount_leakage: { ...leak, leakage: Math.round(leak.offered - leak.realized), leakage_pct: pct(leak.offered - leak.realized, leak.offered) },
      ic_count: icCount.map((r) => ({ ...r, conv_rate: pct(r.converted, r.leads) })),
      lm_reasons: lmReasons,
      task_reasons: taskReasons,
      time_in_stage: timeInStage.sort((a, b) => order(a.stage) - order(b.stage)),
      notes: [
        'Time in stage is approximated as days from lead creation to payment (or today) grouped by CURRENT stage - Salesforce stage history is not replicated.',
        'Discount leakage = max Fees_Offered__c across the lead\'s ICs minus realised home_payment.total, converted leads only.',
      ],
    };
  }),
);
