import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, intParam, pct } from '../http';
import { dimExpr, leadWhere, resolvePeriods, type LeadDim } from '../filters';

export const movers = new Hono<AppEnv>();

const MOVER_DIMS: LeadDim[] = ['lead_source', 'class_group', 'district', 'owner', 'lead_type', 'first_touch_point', 'last_touch_point', 'app_tier', 'campaign_quality'];

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
    type R = { key: string; leads: number; converted: number };
    const all = await Promise.all(
      MOVER_DIMS.map(async (dim) => {
        const e = dimExpr(sql, dim, 'l');
        const [cur, pre] = await Promise.all([
          sql<R[]>`SELECT ${e} AS key, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted FROM analytics.mv_lead_base l WHERE ${leadWhere(sql, f, periods.current)} GROUP BY 1`,
          sql<R[]>`SELECT ${e} AS key, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted FROM analytics.mv_lead_base l WHERE ${leadWhere(sql, f, prev)} GROUP BY 1`,
        ]);
        const pm = new Map(pre.map((r) => [r.key, r]));
        return cur
          .filter((r) => r.leads >= minLeads && (pm.get(r.key)?.leads ?? 0) >= minLeads)
          .map((r) => {
            const p = pm.get(r.key)!;
            const rc = pct(r.converted, r.leads) ?? 0;
            const rp = pct(p.converted, p.leads) ?? 0;
            const delta = Math.round((rc - rp) * 100) / 100;
            return { dim, key: r.key, leads: r.leads, prev_leads: p.leads, converted: r.converted, prev_converted: p.converted, rate: rc, prev_rate: rp, delta_pp: delta, impact: Math.round(delta * r.leads) / 100 };
          });
      }),
    );
    const flat = all.flat().sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    return { previous: prev, min_leads: minLeads, up: flat.filter((r) => r.delta_pp > 0).slice(0, limit), down: flat.filter((r) => r.delta_pp < 0).slice(0, limit) };
  }),
);
