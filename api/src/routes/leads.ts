import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from '../env';
import { handle, intParam, maskEmail, maskName, maskPhone } from '../http';
import { leadWhere, parseFilters, resolvePeriods, type Frag } from '../filters';
import { getSql, release } from '../db';

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
    const where = sql`${leadWhere(sql, f, periods.current)} AND ${searchCond(sql, q.q ?? '')}`;
    const [rows, [tot]] = await Promise.all([
      sql<Rec[]>`
        SELECT ${sql(LIST_COLS)} FROM analytics.v_lead_base l WHERE ${where}
        ORDER BY ${sql(sortCol)} ${dir}, l.lead_id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analytics.v_lead_base l WHERE ${where}`,
    ]);
    return { page, limit, total: tot.n, rows: rows.map((r) => maskRow(r, role)), masked: role === 'viewer' };
  }, 0),
);

/** GET /api/leads/:id : full lead + touch timeline + ICs + payments + calls */
leads.get('/leads/:id', (c) =>
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
  const where = sql`${leadWhere(sql, f, periods.current)} AND ${searchCond(sql, q.q ?? '')}`;
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
        const cursor = sql<Rec[]>`SELECT ${sql(cols)} FROM analytics.v_lead_base l WHERE ${where} ORDER BY ${sql(sortCol)} ${dir}, l.lead_id LIMIT ${cap}`.cursor(500);
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
