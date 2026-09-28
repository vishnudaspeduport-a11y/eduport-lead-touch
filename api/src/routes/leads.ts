import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from '../env';
import { handle, intParam, maskEmail, maskName, maskPhone } from '../http';
import { activeDimKeys, parseFilters, resolvePeriods, type Frag } from '../filters';
import { getSql, release } from '../db';
import { newLeadWhere } from './new_leads';

export const leads = new Hono<AppEnv>();

const SORTABLE: Record<string, string> = {
  created_at: 'created_at', lead_name: 'lead_name', lead_source: 'lead_source', lead_stage: 'lead_stage', class_group: 'class_group',
  owner_name: 'owner_name', total_touches: 'total_touches', valid_touches: 'valid_touches', converted_at: 'converted_at',
  revenue: 'revenue', days_to_convert: 'days_to_convert', first_touch_at: 'first_touch_at', last_touch_any_at: 'last_touch_any_at',
  response_hours: 'response_hours', district: 'district', priority: 'priority',
};

const LIST_COLS = sql_cols([
  'lead_id', 'lead_name', 'first_name', 'last_name', 'mobile', 'email', 'created_at', 'created_date', 'lead_source',
  'lead_stage', 'lead_type', 'priority', 'class_raw', 'class_group', 'district', 'city', 'owner_name', 'is_duplicate',
  'is_paid_lead', 'total_touches', 'valid_touches', 'touch_bucket', 'first_touch_at', 'first_touch_point', 'first_touch_source', 'last_touch_at',
  'last_touch_point', 'last_touch_any_at', 'response_hours', 'converted', 'converted_at', 'days_to_convert', 'pre_existing_customer', 'revenue',
  'payment_count', 'best_ic_status', 'lm_reason', 'sf_is_converted', 'sf_touch_count', 'is_open',
]);
function sql_cols(cols: string[]) { return cols; }

/** sort columns that live on the lead itself: page first, then enrich only the page */
const LEAD_SORT = new Set(['created_at', 'lead_name', 'lead_source', 'lead_stage', 'class_group', 'owner_name', 'district', 'priority']);
/** sort columns computed from the touches (the rest of SORTABLE comes from the payments) */
const TOUCH_SORT = new Set(['total_touches', 'valid_touches', 'first_touch_at', 'last_touch_any_at', 'response_hours']);

/**
 * The explorer list. It used to read analytics.v_lead_base, which recomputes every lead's touch history (window functions over
 * all touches) and payments on each call: ~40 s per page, enough to starve the database when several pages were open.
 * Now: leads from the light lead view, touches from the materialized touch table, payments from the valid-payment view.
 * `page` = { limit, offset }; offset 0 + a large limit serves the CSV export.
 */
function explorerQuery(sql: Sql, where: Frag, sortCol: string, dirIn: Frag, page: { limit: number; offset: number }, asc = false) {
  // creation time is never null: a plain ASC / DESC lets the newest-first page walk the creation-date index instead of sorting every lead
  const dir = sortCol === 'created_at' ? (asc ? sql`ASC` : sql`DESC`) : dirIn;

  // step 1: pick the page's lead ids on a narrow row (id + sort key). Only the side the sort needs is computed for every lead.
  let sortExpr: Frag; let sortJoin: Frag = sql``;
  if (LEAD_SORT.has(sortCol)) sortExpr = sql`l.${sql(sortCol)}`;
  else if (TOUCH_SORT.has(sortCol)) {
    sortJoin = sql`LEFT JOIN (SELECT t.lead_id, count(*)::int AS total_touches, count(*) FILTER (WHERE t.is_pre_conversion)::int AS valid_touches,
                                     min(t.touch_at) AS first_touch_at, max(t.touch_at) AS last_touch_any_at
                              FROM analytics.mv_touch_flat t GROUP BY t.lead_id) ta ON ta.lead_id = l.lead_id`;
    sortExpr = sortCol === 'total_touches' ? sql`COALESCE(ta.total_touches, 0)` : sortCol === 'valid_touches' ? sql`COALESCE(ta.valid_touches, 0)`
      : sortCol === 'response_hours' ? sql`EXTRACT(epoch FROM ta.first_touch_at - l.created_at)` : sql`ta.${sql(sortCol)}`;
  } else {
    sortJoin = sql`LEFT JOIN (SELECT vp.phone_key, min(vp.payment_date) AS converted_at, sum(vp.amount) AS revenue
                              FROM analytics.v_valid_payment vp WHERE vp.phone_key IS NOT NULL GROUP BY vp.phone_key) pay ON pay.phone_key = l.phone_key`;
    sortExpr = sortCol === 'revenue' ? sql`COALESCE(pay.revenue, 0)` : sortCol === 'days_to_convert' ? sql`(pay.converted_at - l.created_date)` : sql`pay.converted_at`;
  }
  const ids = sql`SELECT l.lead_id, ${sortExpr} AS sk FROM analytics.v_lead_conv l ${sortJoin} WHERE ${where}
                  ORDER BY sk ${dir}, l.lead_id LIMIT ${page.limit} OFFSET ${page.offset}`;

  // step 2: the page's rows, with touches and payments looked up per lead (index probes)
  const rows = sql`
    SELECT l.lead_id, l.lead_name, l.first_name, l.last_name, l.mobile, l.email, l.phone_key, l.created_at, l.created_date, l.lead_source, l.lead_stage,
           l.lead_type, l.priority, l.class_raw, l.class_group, l.district, l.city, l.owner_name, l.is_duplicate, l.is_paid_lead,
           l.best_ic_status, l.lm_reason, l.sf_is_converted, l.sf_touch_count
    FROM (${ids}) k JOIN analytics.v_lead_conv l ON l.lead_id = k.lead_id`;
  const inner = sql`
    SELECT s.*, COALESCE(ta.total_touches, 0) AS total_touches, COALESCE(ta.valid_touches, 0) AS valid_touches, analytics.touch_bucket(COALESCE(ta.valid_touches, 0)) AS touch_bucket,
           ta.first_touch_at, ta.first_touch_point, ta.first_touch_source, ta.last_touch_at, ta.last_touch_point, ta.last_touch_any_at,
           round((EXTRACT(epoch FROM ta.first_touch_at - s.created_at) / 3600)::numeric, 2) AS response_hours,
           (COALESCE(pay.payment_count, 0) > 0) AS converted, pay.converted_at, (pay.converted_at - s.created_date)::int AS days_to_convert,
           (pay.converted_at < s.created_date) AS pre_existing_customer, COALESCE(pay.revenue, 0) AS revenue, COALESCE(pay.payment_count, 0) AS payment_count,
           (COALESCE(pay.payment_count, 0) = 0 AND s.lead_stage NOT IN ('Converted', 'Disqualified')) AS is_open
    FROM (${rows}) s
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total_touches, count(*) FILTER (WHERE t.is_pre_conversion)::int AS valid_touches,
             min(t.touch_at) AS first_touch_at, max(t.touch_at) FILTER (WHERE t.is_pre_conversion) AS last_touch_at, max(t.touch_at) AS last_touch_any_at,
             (array_agg(t.touch_point ORDER BY t.touch_at, t.touch_id))[1] AS first_touch_point, (array_agg(t.source ORDER BY t.touch_at, t.touch_id))[1] AS first_touch_source,
             (array_agg(t.touch_point ORDER BY t.touch_at DESC, t.touch_id DESC) FILTER (WHERE t.is_pre_conversion))[1] AS last_touch_point
      FROM analytics.mv_touch_flat t WHERE t.lead_id = s.lead_id) ta ON true
    LEFT JOIN LATERAL (
      SELECT min(vp.payment_date) AS converted_at, count(*)::int AS payment_count, sum(vp.amount) AS revenue
      FROM analytics.v_valid_payment vp WHERE vp.phone_key = s.phone_key) pay ON true`;
  return sql<Rec[]>`SELECT ${sql(LIST_COLS)} FROM (${inner}) x ORDER BY ${sql(sortCol)} ${dir}, lead_id`;
}

function searchCond(sql: Sql, q: string): Frag {
  const s = q.trim();
  if (!s) return sql`true`;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 10) return sql`l.phone_key = ${digits.slice(-10)}`;
  if (digits.length >= 5 && digits.length === s.length) return sql`l.phone_key LIKE ${'%' + digits}`;
  if (/^a02[a-zA-Z0-9]{12,15}$/.test(s)) return sql`l.lead_id = ${s}`;
  if (/^LM-\d+$/i.test(s)) return sql`upper(l.lead_name) = ${s.toUpperCase()}`;
  const like = `${s.toLowerCase()}%`;
  return sql`(lower(l.lead_name) LIKE ${like} OR lower(l.first_name) LIKE ${like} OR lower(l.email) LIKE ${like})`;
}

type Rec = Record<string, unknown>;
function maskRow(r: Rec, role: Role): Rec {
  return {
    ...r,
    mobile: maskPhone(r.mobile as string | null, role),
    email: maskEmail(r.email as string | null, role),
    first_name: maskName(r.first_name as string | null, role),
    last_name: maskName(r.last_name as string | null, role),
  };
}

/** GET /api/leads?page=1&limit=50&sort=created_at&dir=desc&q=... (+ all filters) */
leads.get('/leads', (c) =>
  handle(c, async ({ sql, f, periods, q, role }) => {
    const limit = intParam(q, 'limit', 50, 1, 200);
    const page = intParam(q, 'page', 1, 1, 100000);
    const sortCol = SORTABLE[q.sort ?? ''] ?? 'created_at';
    const dir = q.dir === 'asc' ? sql`ASC NULLS FIRST` : sql`DESC NULLS LAST`;
    // the explorer is not limited by the date window: every lead in the replica, narrowed by the filter pickers and the search box
    void periods;
    const where = sql`${newLeadWhere(sql, f, null, { validPay: true })} AND ${searchCond(sql, q.q ?? '')}`;
    // no filter, no search: count on the base table
    const plain = !(q.q ?? '').trim() && activeDimKeys(f).length === 0 && !f.converted && !f.paid && !f.paid_touch;
    const countQ = plain
      ? sql<{ n: number }[]>`SELECT count(*)::int AS n FROM salesforce.lead_master__c l WHERE COALESCE(l.is_deleted__c, false) = false AND COALESCE(l.isdeleted, false) = false ${f.dups !== '1' ? sql`AND COALESCE(l.is_duplicate__c, false) = false` : sql``}`
      : sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analytics.v_lead_conv l WHERE ${where}`;
    const [rows, [tot]] = await Promise.all([
      explorerQuery(sql, where, sortCol, dir, { limit, offset: (page - 1) * limit }, q.dir === 'asc'),
      countQ,
    ]);
    return { page, limit, total: tot.n, rows: rows.map((r) => maskRow(r, role)), masked: role === 'viewer' };
  }, 0),
);

/** GET /api/leads/:id : full lead + touch timeline + ICs + payments + calls */
// the id pattern keeps this route from swallowing /leads/export.csv (registered below)
leads.get('/leads/:id{[a-zA-Z0-9]+}', (c) =>
  handle(c, async ({ sql, role }) => {
    const id = c.req.param('id');
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) throw Object.assign(new Error('bad lead id'), { status: 400 });
    const [lead] = await sql<Rec[]>`SELECT * FROM analytics.v_lead_base l WHERE l.lead_id = ${id}`;
    if (!lead) throw Object.assign(new Error('lead not found'), { status: 404 });
    const phoneKey = lead.phone_key as string | null;
    const [touches, ics, payments, calls, siblings] = await Promise.all([
      sql<Rec[]>`
        SELECT touch_id, touch_at::text, touch_date::text, touch_point, source, medium, campaign, adset_name, ad_name, platform_id, staff,
               is_pre_conversion, touch_seq, touch_seq_all, is_first_touch, is_last_touch, gap_hours_from_prev, gap_bucket,
               credit_first, credit_last, credit_linear, credit_position, sf_is_first_touch, sf_is_last_touch, sf_is_converted,
               sf_was_customer_at_touch, ic_status, touch_ic_course, is_paid_touch
        FROM analytics.v_touch_base t WHERE t.lead_id = ${id} ORDER BY touch_at, touch_id`,
      sql<Rec[]>`SELECT ic_id, course_name, status, is_enrolled, ic_created_at::text
                 FROM analytics.v_ic_base WHERE lead_id = ${id} ORDER BY ic_created_at`,
      phoneKey
        ? sql<Rec[]>`SELECT vp.payment_id, vp.payment_date::text, b.course_title AS course, b.title AS batch, vp.amount::float8, vp.total::float8, vp.discount::float8, vp.refund_amount::float8,
                            vp.payment_time::text, vp.course_new_id, vp.batch_id, vp.sales_person_id, vp.enrollment_id, vp.payment_type
                     FROM analytics.v_valid_payment vp LEFT JOIN app.core_batch b ON b.id = vp.batch_id
                     WHERE vp.phone_key = ${phoneKey} ORDER BY vp.payment_date, vp.payment_id LIMIT 100`
        : Promise.resolve([] as Rec[]),
      // per-lead call summary (salesforce.lead_calls, reduced from the Salesforce call log since May 2026)
      sql<Rec[]>`SELECT c.calls, c.first_call_at::text AS first_call_at, c.last_call_at::text AS last_call_at, c.last_reason, c.last_comment, c.last_call_status, c.last_subject, u.name AS last_owner
                 FROM salesforce.lead_calls c LEFT JOIN salesforce."user" u ON u.id = c.last_owner_id WHERE c.lead_id = ${id}`,
      phoneKey
        ? sql<Rec[]>`SELECT lead_id, lead_name, created_date::text, lead_source, lead_stage, is_duplicate, converted FROM analytics.v_lead_base
                     WHERE phone_key = ${phoneKey} AND lead_id <> ${id} ORDER BY created_at LIMIT 20`
        : Promise.resolve([] as Rec[]),
    ]);
    const l = maskRow(lead, role);
    // stringify timestamps (postgres.js hands Date objects when types are known; with fetch_types=false they are strings already)
    return { lead: l, touches, ics, payments, calls: [] as Rec[], call_summary: calls[0] ?? null, siblings, masked: role === 'viewer' };
  }, 0),
);

/** GET /api/leads/export.csv : streamed CSV of the current explorer view (capped) */
leads.get('/leads/export.csv', async (c) => {
  const q = c.req.query();
  const f = parseFilters(q);
  const periods = resolvePeriods(f);
  const role = c.get('user').role;
  const cap = Number.parseInt(c.env.EXPORT_ROW_CAP ?? '50000', 10) || 50000;
  const sql = getSql(c.env);
  const sortCol = SORTABLE[q.sort ?? ''] ?? 'created_at';
  const dir = q.dir === 'asc' ? sql`ASC NULLS FIRST` : sql`DESC NULLS LAST`;
  void periods;
  const where = sql`${newLeadWhere(sql, f, null, { validPay: true })} AND ${searchCond(sql, q.q ?? '')}`;
  const cols = LIST_COLS;
  const enc = new TextEncoder();
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(cols.join(',') + '\n'));
        let n = 0;
        const cursor = explorerQuery(sql, where, sortCol, dir, { limit: cap, offset: 0 }, q.dir === 'asc').cursor(500);
        for await (const batch of cursor) {
          let chunk = '';
          for (const r of batch) { const m = maskRow(r, role); chunk += cols.map((k) => esc(m[k])).join(',') + '\n'; n++; }
          controller.enqueue(enc.encode(chunk));
        }
        if (n >= cap) controller.enqueue(enc.encode(`# truncated at ${cap} rows\n`));
        controller.close();
      } catch (e) {
        controller.error(e);
      } finally {
        release(sql, c.executionCtx);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="leads_${periods.current.from}_${periods.current.to}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
