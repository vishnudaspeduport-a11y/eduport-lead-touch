import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { handle, intParam } from '../http';
import { dimExpr, isLeadDim, isTouchDim, leadWhere, touchWhere, type Dim } from '../filters';

export const filters = new Hono<AppEnv>();

/**
 * GET /api/filters?dim=lead_source&q=goo&limit=100&...all other filters
 * Cascading option list: counts are computed under every OTHER active filter
 * (the requested dim itself is skipped so already-selected values stay visible).
 */
filters.get('/filters', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const dim = q.dim;
    if (!dim || !(isLeadDim(dim) || isTouchDim(dim))) {
      throw Object.assign(new Error(`unknown dim "${dim ?? ''}"`), { status: 400 });
    }
    const limit = intParam(q, 'limit', 100, 1, 500);
    const search = (q.q ?? '').trim().toLowerCase();
    const p = periods.current;
    const d = dim as Dim;

    if (isLeadDim(d)) {
      const expr = dimExpr(sql, d, 'l');
      const rows = await sql<{ value: string; leads: number; converted: number }[]>`
        SELECT ${expr} AS value, count(*)::int AS leads, count(*) FILTER (WHERE l.converted)::int AS converted
        FROM analytics.v_lead_base l
        WHERE ${leadWhere(sql, f, p, { skip: d })}
          ${search ? sql`AND lower(${expr}) LIKE ${'%' + search + '%'}` : sql`AND true`}
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${limit}`;
      return { dim: d, options: rows };
    }
    const expr = dimExpr(sql, d, 't');
    const rows = await sql<{ value: string; leads: number; converted: number }[]>`
      SELECT ${expr} AS value, count(DISTINCT t.lead_id)::int AS leads,
             count(DISTINCT t.lead_id) FILTER (WHERE t.converted AND t.is_pre_conversion)::int AS converted
      FROM analytics.v_touch_base t
      WHERE ${touchWhere(sql, f, p, { skip: d })}
        ${search ? sql`AND lower(${expr}) LIKE ${'%' + search + '%'}` : sql`AND true`}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${limit}`;
    return { dim: d, options: rows };
  }, 120),
);
