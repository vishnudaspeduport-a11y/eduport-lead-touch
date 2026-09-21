import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, intParam, pct } from '../http';
import { dimExpr, leadWhere, resolvePeriods, type Filters, type LeadDim, type Period } from '../filters';

export const movers = new Hono<AppEnv>();

const MOVER_DIMS: LeadDim[] = ['lead_source', 'class_group', 'district', 'owner', 'lead_type', 'first_touch_point', 'last_touch_point', 'app_tier', 'campaign_quality'];

type R = { key: string; leads: number; converted: number };

/** Current + previous counts for one dimension in ONE round trip (keeps pooled connections few and short-lived). */
async function moverDim(sql: Sql, f: Filters, dim: LeadDim, cur: Period, prev: Period) {
  const e = dimExpr(sql, dim, 'l');
  const rows = await sql<(R & { period: 'cur' | 'prev' })[]>`
    SELECT 'cur'::text AS period, ${e} AS key, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted
    FROM analytics.mv_lead_base l WHERE ${leadWhere(sql, f, cur)} GROUP BY 2
    UNION ALL
    SELECT 'prev'::text, ${e}, count(*)::int, count(*) FILTER (WHERE l.converted)::int
    FROM analytics.mv_lead_base l WHERE ${leadWhere(sql, f, prev)} GROUP BY 2`;
  return { dim, cur: rows.filter((r) => r.period === 'cur'), prev: rows.filter((r) => r.period === 'prev') };
}

/**
 * GET /api/movers?min=30&limit=12
 * Segments whose conversion rate moved most vs the comparison period (always
 * "previous period" here even if compare=none). impact = delta_pp * current leads.
 */
movers.get('/movers', (c) =>
  handle(c, async ({ sql, f, q }) => {
    const minLeads = intParam(q, 'min', 30, 1, 100000);
    const limit = intParam(q, 'limit', 12, 1, 100);
    const periods = resolvePeriods({ ...f, compare: 'previous' });
    const prev = periods.previous!;
    const flat: { dim: LeadDim; key: string; leads: number; prev_leads: number; converted: number; prev_converted: number; rate: number; prev_rate: number; delta_pp: number; impact: number }[] = [];
    // sequential per dimension on purpose: a 2x9 parallel fan-out left dangling sessions on the pooler
    for (const dim of MOVER_DIMS) {
      const { cur, prev: pre } = await moverDim(sql, f, dim, periods.current, prev);
      const pm = new Map(pre.map((r) => [r.key, r]));
      for (const r of cur) {
        const p = pm.get(r.key);
        if (r.leads < minLeads || !p || p.leads < minLeads) continue;
        const rc = pct(r.converted, r.leads) ?? 0;
        const rp = pct(p.converted, p.leads) ?? 0;
        const delta = Math.round((rc - rp) * 100) / 100;
        flat.push({ dim, key: r.key, leads: r.leads, prev_leads: p.leads, converted: r.converted, prev_converted: p.converted, rate: rc, prev_rate: rp, delta_pp: delta, impact: Math.round(delta * r.leads) / 100 });
      }
    }
    flat.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    return { previous: prev, min_leads: minLeads, up: flat.filter((r) => r.delta_pp > 0).slice(0, limit), down: flat.filter((r) => r.delta_pp < 0).slice(0, limit) };
  }),
);
