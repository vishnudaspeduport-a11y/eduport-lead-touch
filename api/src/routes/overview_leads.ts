import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from '../env';
import { handle, intParam, maskEmail, maskName, maskPhone } from '../http';
import { parseFilters, resolvePeriods, type Filters, type Frag, type Period } from '../filters';
import { getSql, release } from '../db';
import { flatWhere, FLAT_COLS } from './overview';

/**
 * Drill-down for the Overview: the leads behind any KPI, bar, donut slice or table row.
 *   GET /api/overview/leads?metric=leads|touches|converted|converted_first|converted_in_window|sf_converted|avg_alltime|avg_window
 *                          [&dim=touch_point&value=Eduport%20App] [&q=search] [&page&limit&sort&dir]
 *   GET /api/overview/leads.csv  (same params, streamed, capped by EXPORT_ROW_CAP)
 * One row per lead; touch columns summarise that lead's touches inside the selection.
 * Two steps: (1) a light GROUP BY over the selection picks + sorts + pages the lead ids, (2) the page is enriched
 * per lead (lead_master join + a LATERAL aggregate over that lead's touches), so a 25k-lead list pages in well under a second.
 */
export const overviewLeads = new Hono<AppEnv>();

type Rec = Record<string, unknown>;
const METRICS = ['leads', 'touches', 'converted', 'converted_paid', 'converted_first', 'converted_in_window', 'sf_converted', 'avg_alltime', 'avg_window'] as const;
type Metric = (typeof METRICS)[number];

const SORTABLE: Record<string, string> = {
  lead_name: 'lead_name', created_date: 'lead_created_date', lead_stage: 'lead_stage', class_raw: 'class_raw', lead_source: 'lead_source',
  owner_name: 'owner_name', touches_in_window: 'touches_in_window', n_touches_all: 'n_touches_all', last_touch_in_window: 'last_touch_in_window',
  converted_at: 'converted_at', last_payment_date: 'last_payment_date', revenue: 'revenue', district: 'district',
};

const COLS = [
  'lead_id', 'lead_name', 'eps_id', 'first_name', 'last_name', 'mobile', 'email', 'lead_created_date', 'lead_source', 'lead_stage', 'lead_type', 'priority',
  'class_raw', 'class_group', 'district', 'city', 'owner_name', 'campaign_quality', 'app_engagement_tier', 'best_ic_status', 'lm_reason', 'is_duplicate',
  'touches_in_window', 'n_touches_all', 'first_touch_in_window', 'last_touch_in_window', 'touch_points', 'sources', 'staff',
  'tab_converted', 'converted_paid', 'converted_first', 'converted', 'converted_at', 'last_payment_date', 'revenue', 'courses', 'sf_is_converted', 'sf_touch_count',
];

function dimCond(sql: Sql, q: Record<string, string>): Frag {
  const dim = q.dim; const value = q.value;
  if (!dim || value === undefined) return sql`true`;
  if (dim === 'ic_status') {
    return sql`t.lead_id IN (SELECT ic.lead_master__c FROM salesforce.interested_course__c ic WHERE NOT ic.isdeleted AND btrim(ic.status__c) = ${value})`;
  }
  const col = FLAT_COLS[dim as keyof typeof FLAT_COLS] ?? (dim === 'touch_date' ? 'touch_date' : undefined);
  if (!col) throw Object.assign(new Error(`unknown dim ${dim}`), { status: 400 });
  const ref = sql`t.${sql(col)}`;
  return value === '(null)' ? sql`${ref} IS NULL` : sql`${ref}::text = ${value}`;
}

function metricHaving(sql: Sql, metric: Metric, p: Period): Frag {
  switch (metric) {
    case 'converted': return sql`bool_or(t.tab_converted)`;
    case 'converted_paid': return sql`bool_or(t.tab_converted_paid)`;
    case 'converted_first': return sql`bool_or(t.converted AND t.is_pre_conversion)`;
    case 'converted_in_window': return sql`bool_or(t.converted AND t.converted_at BETWEEN ${p.from} AND ${p.to})`;
    case 'sf_converted': return sql`bool_or(t.lead_sf_is_converted)`;
    case 'avg_alltime': case 'avg_window': return sql`bool_or(t.converted)`;
    default: return sql`true`;
  }
}

function searchCond(sql: Sql, s: string): Frag {
  s = s.trim();
  if (!s) return sql`true`;
  const digits = s.replace(/\D/g, '');
  let inner: Frag;
  if (digits.length >= 5 && digits.length === s.length) inner = sql`l.mobile_number__c LIKE ${'%' + digits + '%'}`;
  else if (/^a02[a-zA-Z0-9]{12,15}$/.test(s)) inner = sql`l.id = ${s}`;
  else if (/^LM-\d+$/i.test(s)) inner = sql`upper(l.name) = ${s.toUpperCase()}`;
  else { const like = `%${s.toLowerCase()}%`; inner = sql`(lower(l.name) LIKE ${like} OR lower(l.first_name__c) LIKE ${like} OR lower(l.last_name__c) LIKE ${like} OR lower(l.email__c) LIKE ${like})`; }
  return sql`t.lead_id IN (SELECT l.id FROM salesforce.lead_master__c l WHERE ${inner})`;
}

function maskRow(r: Rec, role: Role): Rec {
  return { ...r, mobile: maskPhone(r.mobile as string | null, role), email: maskEmail(r.email as string | null, role), first_name: maskName(r.first_name as string | null, role), last_name: maskName(r.last_name as string | null, role) };
}

/** the lead list; `page` null = no paging (export) */
function leadQuery(sql: Sql, f: Filters, periods: { current: Period }, q: Record<string, string>, page: { limit: number; offset: number } | null) {
  const metric = (METRICS as readonly string[]).includes(q.metric ?? '') ? (q.metric as Metric) : 'leads';
  const w = flatWhere(sql, f, metric === 'avg_alltime' ? null : periods.current);
  const sel = sql`${w} AND ${dimCond(sql, q)} AND ${searchCond(sql, q.q ?? '')}`;
  const sortCol = SORTABLE[q.sort ?? ''] ?? 'touches_in_window';
  const dir = q.dir === 'asc' ? sql`ASC NULLS FIRST` : sql`DESC NULLS LAST`;
  return sql<Rec[]>`
    WITH sel AS (
      SELECT t.lead_id, count(*)::int AS touches_in_window, max(t.n_touches_all)::int AS n_touches_all,
             min(t.touch_at) AS first_touch_in_window, max(t.touch_at) AS last_touch_in_window,
             max(t.lead_name) AS lead_name, max(t.lead_created_date) AS lead_created_date, max(t.lead_stage) AS lead_stage, max(t.class_raw) AS class_raw,
             max(t.lead_source) AS lead_source, max(t.owner_name) AS owner_name, max(t.district) AS district,
             max(t.converted_at) AS converted_at, max(t.last_payment_date) AS last_payment_date, max(t.revenue) AS revenue
      FROM analytics.mv_touch_flat t
      WHERE ${sel}
      GROUP BY t.lead_id
      HAVING ${metricHaving(sql, metric, periods.current)}
    ),
    pg AS (
      SELECT sel.*, count(*) OVER ()::int AS total_rows FROM sel
      ORDER BY ${sql(sortCol)} ${dir}, lead_id
      ${page ? sql`LIMIT ${page.limit} OFFSET ${page.offset}` : sql``}
    )
    SELECT pg.lead_id, pg.lead_name, x.eps_id, l.first_name__c AS first_name, l.last_name__c AS last_name, l.mobile_number__c AS mobile, l.email__c AS email,
           pg.lead_created_date::text AS lead_created_date, pg.lead_source, pg.lead_stage, x.lead_type, x.priority, pg.class_raw, x.class_group,
           pg.district, x.city, pg.owner_name, x.campaign_quality, x.app_engagement_tier, x.best_ic_status, x.lm_reason, x.is_duplicate,
           pg.touches_in_window, pg.n_touches_all, pg.first_touch_in_window::text AS first_touch_in_window, pg.last_touch_in_window::text AS last_touch_in_window,
           x.touch_points, x.sources, x.staff, x.tab_converted, x.converted_paid, x.converted_first, x.converted,
           pg.converted_at::text AS converted_at, pg.last_payment_date::text AS last_payment_date, pg.revenue::float8 AS revenue, x.courses,
           x.sf_is_converted, x.sf_touch_count, pg.total_rows
    FROM pg
    JOIN salesforce.lead_master__c l ON l.id = pg.lead_id
    JOIN LATERAL (
      SELECT max(t.lead_type) AS lead_type, max(t.priority) AS priority, max(t.class_group) AS class_group, max(t.city) AS city,
             max(t.campaign_quality) AS campaign_quality, max(t.app_engagement_tier) AS app_engagement_tier, max(t.best_ic_status) AS best_ic_status,
             max(t.lm_reason) AS lm_reason, bool_or(t.is_duplicate) AS is_duplicate,
             string_agg(DISTINCT t.touch_point, ', ') AS touch_points, string_agg(DISTINCT t.source, ', ') AS sources,
             string_agg(DISTINCT t.staff, ', ') FILTER (WHERE t.staff IS NOT NULL) AS staff,
             bool_or(t.tab_converted) AS tab_converted, bool_or(t.tab_converted_paid) AS converted_paid, bool_or(t.converted AND t.is_pre_conversion) AS converted_first, bool_or(t.converted) AS converted,
             max(t.courses) AS courses,
             bool_or(t.lead_sf_is_converted) AS sf_is_converted, max(t.sf_touch_count)::int AS sf_touch_count,
             max(t.app_user_id)::int AS eps_id
      FROM analytics.mv_touch_flat t WHERE t.lead_id = pg.lead_id AND ${sel}
    ) x ON true
    ORDER BY pg.${sql(sortCol)} ${dir}, pg.lead_id`;
}

overviewLeads.get('/overview/leads', (c) =>
  handle(c, async ({ sql, f, periods, q, role }) => {
    const limit = intParam(q, 'limit', 50, 1, 200);
    const page = intParam(q, 'page', 1, 1, 100000);
    const rows = await leadQuery(sql, f, periods, q, { limit, offset: (page - 1) * limit });
    const total = rows.length ? (rows[0].total_rows as number) : 0;
    return { page, limit, total, rows: rows.map((r) => { const { total_rows: _t, ...rest } = maskRow(r, role); return rest; }), masked: role === 'viewer', columns: COLS };
  }, 0),
);

overviewLeads.get('/overview/leads.csv', async (c) => {
  const q = c.req.query();
  const f = parseFilters(q);
  const periods = resolvePeriods(f);
  const role = c.get('user').role;
  const cap = Number.parseInt(c.env.EXPORT_ROW_CAP ?? '50000', 10) || 50000;
  const sql = getSql(c.env);
  const enc = new TextEncoder();
  const esc = (v: unknown) => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(COLS.join(',') + '\n'));
        const rows = await leadQuery(sql, f, periods, q, { limit: cap, offset: 0 });
        let chunk = '';
        for (const r of rows) { const m = maskRow(r, role); chunk += COLS.map((k) => esc(m[k])).join(',') + '\n'; if (chunk.length > 65536) { controller.enqueue(enc.encode(chunk)); chunk = ''; } }
        if (rows.length >= cap) chunk += `# truncated at ${cap} rows\n`;
        if (chunk) controller.enqueue(enc.encode(chunk));
        controller.close();
      } catch (e) { controller.error(e); } finally { release(sql, c.executionCtx); }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="leads_${q.metric ?? 'leads'}_${periods.current.from}_${periods.current.to}.csv"`, 'cache-control': 'private, no-store' } });
});
