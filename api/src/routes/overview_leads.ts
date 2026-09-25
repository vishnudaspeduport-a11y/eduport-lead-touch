import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from '../env';
import { handle, intParam, maskEmail, maskName, maskPhone } from '../http';
import { parseFilters, resolvePeriods, type Filters, type Frag, type Period } from '../filters';
import { getSql, release } from '../db';
import { flatWhere, FLAT_COLS, convCond, convFirstCond } from './overview';
import { paymentPeriod } from '../filters';

/**
 * Drill-down for the Overview: the leads behind any KPI, bar, donut slice or table row.
 *   GET /api/overview/leads?metric=leads|touches|converted|converted_first|sf_converted|avg_alltime|avg_window
 *                          [&dim=touch_point&value=Eduport%20App] [&q=search] [&page&limit&sort&dir]
 *   GET /api/overview/leads.csv  (same params, streamed, capped by EXPORT_ROW_CAP)
 *   GET /api/overview/leads/summary (same params): the same leads split by purchased grade / course, stage, class, source, touch point ...
 * One row per lead; touch columns summarise that lead's touches inside the selection.
 * Two steps: (1) a light GROUP BY over the selection picks + sorts + pages the lead ids, (2) the page is enriched
 * per lead (lead_master join + a LATERAL aggregate over that lead's touches), so a 25k-lead list pages in well under a second.
 */
export const overviewLeads = new Hono<AppEnv>();

type Rec = Record<string, unknown>;
const METRICS = ['leads', 'touches', 'converted', 'first_touch', 'last_touch', 'stale_new', 'stale_not_connected', 'converted_first', 'sf_converted', 'stage_conv_unpaid', 'paid_other_stage', 'avg_alltime', 'avg_window'] as const;
type Metric = (typeof METRICS)[number];

const SORTABLE: Record<string, string> = {
  lead_name: 'lead_name', created_date: 'lead_created_date', lead_stage: 'lead_stage', class_raw: 'class_raw', lead_source: 'lead_source',
  owner_name: 'owner_name', touches_in_window: 'touches_in_window', n_touches_all: 'n_touches_all', last_touch_in_window: 'last_touch_in_window',
  converted_at: 'converted_at', last_payment_date: 'last_payment_date', revenue: 'revenue', district: 'district',
};

const COLS = [
  'lead_id', 'lead_name', 'eps_id', 'first_name', 'last_name', 'mobile', 'email', 'lead_created_date', 'lead_source', 'lead_stage', 'lead_type', 'priority',
  'class_raw', 'class_group', 'district', 'city', 'owner_name', 'best_ic_status', 'lm_reason', 'is_duplicate',
  'touches_in_window', 'n_touches_all', 'first_touch_in_window', 'last_touch_in_window', 'last_touch_any', 'days_since_last_touch', 'touch_points', 'sources', 'staff',
  'tab_converted', 'first_touch_point', 'last_touch_point', 'converted_first', 'converted', 'converted_at', 'last_payment_date', 'revenue', 'courses', 'sf_is_converted', 'sf_touch_count',
];

const VALID_PAY = (sql: Sql) => sql`hp.payment_method = 0 AND hp.deleted = false AND hp.is_success = true AND hp.payment_success = true`;

function dimCond(sql: Sql, q: Record<string, string>): Frag {
  const dim = q.dim; const value = q.value;
  if (!dim || value === undefined) return sql`true`;
  if (dim === 'ic_status') {
    return sql`t.lead_id IN (SELECT ic.lead_master__c FROM salesforce.interested_course__c ic WHERE NOT ic.isdeleted AND btrim(ic.status__c) = ${value})`;
  }
  if (dim === 'course' || dim === 'grade') {
    // purchased course / grade: any valid payment of the lead's app user on that batch
    const keyExpr = dim === 'course' ? sql`COALESCE(b.course_title, 'batch ' || hp.batch_id::text)` : sql`COALESCE(b.grade_title, 'No Grade On Batch')`;
    return sql`EXISTS (SELECT 1 FROM app.home_payment hp LEFT JOIN app.core_batch b ON b.id = hp.batch_id
                       WHERE hp.user_id = t.app_user_id AND ${VALID_PAY(sql)} AND ${keyExpr} = ${value})`;
  }
  const col = FLAT_COLS[dim as keyof typeof FLAT_COLS] ?? (dim === 'touch_date' ? 'touch_date' : undefined);
  if (!col) throw Object.assign(new Error(`unknown dim ${dim}`), { status: 400 });
  const ref = sql`t.${sql(col)}`;
  return value === '(null)' ? sql`${ref} IS NULL` : sql`${ref}::text = ${value}`;
}

function metricHaving(sql: Sql, metric: Metric, p: Period, f?: Filters, q: Record<string, string> = {}): Frag {
  const conv = f ? convCond(sql, f) : sql`t.tab_converted`;
  switch (metric) {
    case 'stale_new': case 'stale_not_connected': {
      const days = Math.max(1, Math.min(365, Number.parseInt(q.stale_days ?? '5', 10) || 5));
      const stage = metric === 'stale_new' ? 'New' : 'Not Connected';
      return sql`max(t.lead_stage) = ${stage} AND max(t.lead_created_date) <= (now() AT TIME ZONE 'Asia/Kolkata')::date - ${days}::int
        AND (SELECT max(t2.touch_at) FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = t.lead_id) < now() - make_interval(days => ${days})`;
    }
    case 'converted': return sql`bool_or(${conv})`;
    case 'first_touch': return sql`bool_or(t.tab_is_first_touch AND ${conv})`;
    case 'last_touch': return sql`bool_or(t.tab_is_last_touch AND ${conv})`;
    case 'converted_first': return sql`bool_or(${f ? convFirstCond(sql, f) : sql`(t.converted AND t.is_pre_conversion)`})`;
    case 'sf_converted': return sql`bool_or(t.lead_sf_is_converted)`;
    case 'stage_conv_unpaid': return sql`max(t.lead_stage) = 'Converted' AND NOT bool_or(t.converted)`;
    case 'paid_other_stage': return sql`bool_or(${conv}) AND max(t.lead_stage) IS DISTINCT FROM 'Converted'`;
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

/** the selection shared by the list, the CSV and the summary: touch-row condition + per-lead GROUP BY / HAVING */
function selection(sql: Sql, f: Filters, periods: { current: Period }, q: Record<string, string>) {
  const metric = (METRICS as readonly string[]).includes(q.metric ?? '') ? (q.metric as Metric) : 'leads';
  const w = flatWhere(sql, f, metric === 'avg_alltime' ? null : periods.current);
  const sel = sql`${w} AND ${dimCond(sql, q)} AND ${searchCond(sql, q.q ?? '')}`;
  const having = metricHaving(sql, metric, periods.current, f, q);
  return { metric, sel, having };
}

/** the lead list; `page` null = no paging (export) */
function leadQuery(sql: Sql, f: Filters, periods: { current: Period }, q: Record<string, string>, page: { limit: number; offset: number } | null) {
  const { metric, sel, having } = selection(sql, f, periods, q);
  const sortCol = SORTABLE[q.sort ?? ''] ?? (metric.startsWith('stale') ? 'last_touch_in_window' : 'touches_in_window');
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
      HAVING ${having}
    ),
    pg AS (
      SELECT sel.*, count(*) OVER ()::int AS total_rows FROM sel
      ORDER BY ${sql(sortCol)} ${dir}, lead_id
      ${page ? sql`LIMIT ${page.limit} OFFSET ${page.offset}` : sql``}
    )
    SELECT pg.lead_id, pg.lead_name, x.eps_id, l.first_name__c AS first_name, l.last_name__c AS last_name, l.mobile_number__c AS mobile, l.email__c AS email,
           pg.lead_created_date::text AS lead_created_date, pg.lead_source, pg.lead_stage, x.lead_type, x.priority, pg.class_raw, x.class_group,
           pg.district, x.city, pg.owner_name, x.best_ic_status, x.lm_reason, x.is_duplicate,
           pg.touches_in_window, pg.n_touches_all, pg.first_touch_in_window::text AS first_touch_in_window, pg.last_touch_in_window::text AS last_touch_in_window,
           la.last_touch_any::text AS last_touch_any, floor(EXTRACT(epoch FROM now() - la.last_touch_any) / 86400)::int AS days_since_last_touch,
           x.touch_points, x.sources, x.staff, x.tab_converted, x.first_touch_point, x.last_touch_point, x.converted_first, x.converted,
           pg.converted_at::text AS converted_at, pg.last_payment_date::text AS last_payment_date, pg.revenue::float8 AS revenue, x.courses,
           x.sf_is_converted, x.sf_touch_count, pg.total_rows
    FROM pg
    JOIN salesforce.lead_master__c l ON l.id = pg.lead_id
    JOIN LATERAL (SELECT max(t2.touch_at) AS last_touch_any FROM analytics.mv_touch_flat t2 WHERE t2.lead_id = pg.lead_id) la ON true
    JOIN LATERAL (
      SELECT max(t.lead_type) AS lead_type, max(t.priority) AS priority, max(t.class_group) AS class_group, max(t.city) AS city,
             max(t.best_ic_status) AS best_ic_status,
             max(t.lm_reason) AS lm_reason, bool_or(t.is_duplicate) AS is_duplicate,
             string_agg(DISTINCT t.touch_point, ', ') AS touch_points, string_agg(DISTINCT t.source, ', ') AS sources,
             string_agg(DISTINCT t.staff, ', ') FILTER (WHERE t.staff IS NOT NULL) AS staff,
             bool_or(t.tab_converted) AS tab_converted, bool_or(t.converted AND t.is_pre_conversion) AS converted_first, bool_or(t.converted) AS converted,
             max(t.courses) AS courses,
             max(t.touch_point) FILTER (WHERE t.tab_is_first_touch) AS first_touch_point, max(t.touch_point) FILTER (WHERE t.tab_is_last_touch) AS last_touch_point,
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

const SPLITS: { dim: string; label: string; kind: 'lead' | 'touch' | 'pay' }[] = [
  { dim: 'grade', label: 'Purchased grade', kind: 'pay' }, { dim: 'course', label: 'Purchased course', kind: 'pay' },
  { dim: 'lead_stage', label: 'Lead stage', kind: 'lead' }, { dim: 'class_group', label: 'Lead class', kind: 'lead' }, { dim: 'lead_source', label: 'Lead source', kind: 'lead' },
  { dim: 'touch_point', label: 'Touch point', kind: 'touch' }, { dim: 'source', label: 'Source', kind: 'touch' }, { dim: 'medium', label: 'Medium', kind: 'touch' },
  { dim: 'owner', label: 'Owner', kind: 'lead' }, { dim: 'district', label: 'District', kind: 'lead' }, { dim: 'ic_status', label: 'IC status', kind: 'lead' }, { dim: 'lm_reason', label: 'LM reason', kind: 'lead' },
];

/** GET /overview/leads/summary : the selected leads split by purchase + lead + touch dimensions (for the drill drawer's overview) */
overviewLeads.get('/overview/leads/summary', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const { sel, having } = selection(sql, f, periods, q);
    const pp = paymentPeriod(f);
    const payWin = pp ? sql`AND hp.payment_date BETWEEN ${pp.from} AND ${pp.to}` : sql``;
    const rows = await sql<{ dim: string; key: string | null; leads: number; revenue: number | null }[]>`
      WITH sel AS (
        SELECT t.lead_id, max(t.app_user_id) AS app_user_id, max(t.revenue) AS revenue, count(*)::int AS touches_in_window
        FROM analytics.mv_touch_flat t WHERE ${sel} GROUP BY t.lead_id HAVING ${having}
      )
      SELECT '_total' AS dim, NULL AS key, count(*)::int AS leads, sum(revenue)::float8 AS revenue FROM sel
      UNION ALL
      SELECT '_touches' AS dim, NULL AS key, sum(touches_in_window)::int AS leads, NULL::float8 AS revenue FROM sel
      UNION ALL
      SELECT d.dim, d.key, count(DISTINCT t.lead_id)::int AS leads, NULL::float8 AS revenue
      FROM analytics.mv_touch_flat t JOIN sel s ON s.lead_id = t.lead_id
      CROSS JOIN LATERAL (VALUES ('lead_stage', t.lead_stage), ('class_group', t.class_group), ('lead_source', t.lead_source),
                                 ('touch_point', t.touch_point), ('source', t.source), ('medium', t.medium),
                                 ('owner', t.owner_name), ('district', t.district), ('ic_status', t.best_ic_status), ('lm_reason', t.lm_reason)) AS d(dim, key)
      WHERE ${sel}
      GROUP BY d.dim, d.key
      UNION ALL
      SELECT p.dim, p.key, count(DISTINCT p.lead_id)::int AS leads, sum(p.amount)::float8 AS revenue
      FROM (
        SELECT s.lead_id, hp.amount, 'course' AS dim, COALESCE(b.course_title, 'batch ' || hp.batch_id::text) AS key
        FROM sel s JOIN app.home_payment hp ON hp.user_id = s.app_user_id LEFT JOIN app.core_batch b ON b.id = hp.batch_id
        WHERE ${VALID_PAY(sql)} ${payWin}
        UNION ALL
        SELECT s.lead_id, hp.amount, 'grade' AS dim, COALESCE(b.grade_title, 'No Grade On Batch') AS key
        FROM sel s JOIN app.home_payment hp ON hp.user_id = s.app_user_id LEFT JOIN app.core_batch b ON b.id = hp.batch_id
        WHERE ${VALID_PAY(sql)} ${payWin}
      ) p
      GROUP BY p.dim, p.key`;
    const total = rows.find((r) => r.dim === '_total');
    const touches = rows.find((r) => r.dim === '_touches');
    const splits = SPLITS.map((s) => {
      const list = rows.filter((r) => r.dim === s.dim).map((r) => ({ key: r.key ?? '(blank)', leads: r.leads, revenue: r.revenue })).sort((a, b) => b.leads - a.leads);
      return { ...s, rows: list.slice(0, 40), distinct: list.length };
    });
    return { leads: total?.leads ?? 0, revenue: total?.revenue ?? 0, touches: touches?.leads ?? 0, payment_window: pp, splits };
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
