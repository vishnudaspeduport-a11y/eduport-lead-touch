import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv } from '../env';
import { handle, intParam, pct } from '../http';
import {
  dimExpr, isLeadDim, isTouchDim, leadWhere, touchWhere, LEAD_DIMS_ON_TOUCH,
  type Dim, type Filters, type Period, type LeadDim,
} from '../filters';

export const breakdown = new Hono<AppEnv>();

export interface BreakdownRow {
  key: string; key2?: string | null;
  leads: number; converted: number; conv_rate: number | null; revenue: number; revenue_per_lead: number | null;
  touches: number; avg_touches: number | null; contacted: number;
  conv_first?: number; conv_last?: number; conv_linear?: number;
}

const SORTS = new Set(['leads', 'converted', 'conv_rate', 'revenue', 'touches', 'avg_touches']);

function badDim(d: string): never {
  throw Object.assign(new Error(`unknown or unsupported dim "${d}"`), { status: 400 });
}

export async function breakdownFor(sql: Sql, f: Filters, p: Period, dim: Dim, dim2: Dim | null, limit: number): Promise<{ rows: BreakdownRow[]; total: BreakdownRow; mode: 'lead' | 'touch' }> {
  const dims = [dim, dim2].filter(Boolean) as Dim[];
  const touchMode = dims.some(isTouchDim);

  if (!touchMode) {
    const e1 = dimExpr(sql, dim, 'l');
    const e2 = dim2 ? dimExpr(sql, dim2, 'l') : sql`NULL::text`;
    const lw = leadWhere(sql, f, p);
    const sel = sql`
      count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted,
      COALESCE(sum(l.revenue),0)::float8 AS revenue, COALESCE(sum(l.total_touches),0)::int AS touches,
      avg(l.valid_touches)::float8 AS avg_touches, count(*) FILTER (WHERE l.contacted)::int AS contacted`;
    const [rows, [total]] = await Promise.all([
      sql<BreakdownRow[]>`SELECT ${e1} AS key, ${e2} AS key2, ${sel} FROM analytics.mv_lead_base l WHERE ${lw} GROUP BY 1,2 ORDER BY leads DESC, 1 LIMIT ${limit}`,
      sql<BreakdownRow[]>`SELECT 'Total'::text AS key, NULL::text AS key2, ${sel} FROM analytics.mv_lead_base l WHERE ${lw}`,
    ]);
    return { rows: rows.map(fin), total: fin(total), mode: 'lead' };
  }

  // touch mode: every dim must be a touch dim or a lead dim that is carried on mv_touch_base
  for (const d of dims) if (isLeadDim(d) && !LEAD_DIMS_ON_TOUCH.has(d as LeadDim)) badDim(d);
  const e1 = dimExpr(sql, dim, 't');
  const e2 = dim2 ? dimExpr(sql, dim2, 't') : sql`NULL::text`;
  const tw = touchWhere(sql, f, p);
  const sel = sql`
    count(DISTINCT t.lead_id)::int AS leads,
    count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted,
    COALESCE(sum(t.credit_linear * t.revenue),0)::float8 AS revenue,
    count(*)::int AS touches,
    (count(*)::float8 / NULLIF(count(DISTINCT t.lead_id),0))::float8 AS avg_touches,
    count(DISTINCT t.lead_id)::int AS contacted,
    COALESCE(sum(t.credit_first),0)::float8 AS conv_first,
    COALESCE(sum(t.credit_last),0)::float8 AS conv_last,
    COALESCE(sum(t.credit_linear),0)::float8 AS conv_linear`;
  const [rows, [total]] = await Promise.all([
    sql<BreakdownRow[]>`SELECT ${e1} AS key, ${e2} AS key2, ${sel} FROM analytics.mv_touch_base t WHERE ${tw} GROUP BY 1,2 ORDER BY leads DESC, 1 LIMIT ${limit}`,
    sql<BreakdownRow[]>`SELECT 'Total'::text AS key, NULL::text AS key2, ${sel} FROM analytics.mv_touch_base t WHERE ${tw}`,
  ]);
  return { rows: rows.map(fin), total: fin(total), mode: 'touch' };
}

function fin(r: BreakdownRow): BreakdownRow {
  return {
    ...r,
    conv_rate: pct(r.converted, r.leads),
    revenue_per_lead: r.leads ? Math.round(r.revenue / r.leads) : null,
    avg_touches: r.avg_touches == null ? null : Math.round(r.avg_touches * 100) / 100,
  };
}

/**
 * GET /api/breakdown?dim=lead_source[&dim2=medium][&limit=20][&sort=conv_rate]
 * Lead dims aggregate mv_lead_base (leads counted once). Touch dims aggregate
 * mv_touch_base (leads = distinct leads touched; revenue = linear-attributed).
 */
breakdown.get('/breakdown', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const dim = q.dim ?? '';
    if (!(isLeadDim(dim) || isTouchDim(dim))) badDim(dim);
    const dim2 = q.dim2 ? (isLeadDim(q.dim2) || isTouchDim(q.dim2) ? (q.dim2 as Dim) : badDim(q.dim2)) : null;
    const limit = intParam(q, 'limit', 25, 1, 500);
    const sort = SORTS.has(q.sort ?? '') ? (q.sort as keyof BreakdownRow) : 'leads';

    const [cur, prev] = await Promise.all([
      breakdownFor(sql, f, periods.current, dim as Dim, dim2, dim2 ? limit * 8 : limit),
      periods.previous ? breakdownFor(sql, f, periods.previous, dim as Dim, dim2, 500) : Promise.resolve(null),
    ]);
    const prevMap = new Map<string, BreakdownRow>();
    prev?.rows.forEach((r) => prevMap.set(`${r.key}${r.key2 ?? ''}`, r));
    const rows = cur.rows
      .map((r) => ({ ...r, previous: prevMap.get(`${r.key}${r.key2 ?? ''}`) ?? null }))
      .sort((a, b) => ((b[sort] as number) ?? -1) - ((a[sort] as number) ?? -1));
    return { dim, dim2, mode: cur.mode, rows, total: cur.total, previousTotal: prev?.total ?? null };
  }),
);
