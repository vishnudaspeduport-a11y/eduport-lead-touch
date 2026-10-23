import { Hono } from 'hono';
import type { Sql } from 'postgres';
import type { AppEnv, Role } from '../env';
import { handle, intParam, maskEmail, maskName, maskPhone, pct, csvStream } from '../http';
import { LIST_KEYS, parseFilters, resolvePeriods, type Filters, type Frag, type Period } from '../filters';

/**
 * "Converted" page = Tableau workbook "Converted", dashboard "Lead Touch - Converted".
 *   grain   : paying app user with a valid payment whose PAYMENT DATE is in the window (the page's date range is the payment date)
 *   credit  : the user's last touch on/before its last valid payment date (same day included), across all leads on the same phone;
 *             users with no touch before the payment are shown as "No Touch Before Payment"
 *   class   : grade of the purchased course (core_grade.title) -> the in-page "Purchased grade" filter and table
 *   sheets  : CONVERTED (users), Lead stage distribution, Class wise conversion (purchased course), STAFF-WISE,
 *             Lead source / Touch point / Medium / Campaign by LAST touch
 * Reads analytics.mv_payer (one row per paying user) + app.home_payment/app.core_batch for per-payment course & grade.
 */
export const converted = new Hono<AppEnv>();

type Rec = Record<string, unknown>;
/** pm = all | m0 (Tableau rule, payment_method 0) | m1 (payment_method 1 = gateway EMI instalments) */
export type PayMethod = 'all' | 'm0' | 'm1';
export const payMethod = (q: Record<string, string>): PayMethod => (q.pm === 'm0' || q.pm === 'm1' ? q.pm : 'all');
const VALID = (sql: Sql, pm: PayMethod = 'all') => sql`hp.deleted = false AND hp.is_success = true AND hp.payment_success = true ${pm === 'm0' ? sql`AND hp.payment_method = 0` : pm === 'm1' ? sql`AND hp.payment_method <> 0` : sql``}`;

/** global filter chips that make sense on the payer grain */
const PAYER_COLS: Partial<Record<(typeof LIST_KEYS)[number], string>> = {
  lead_stage: 'lead_stage', lead_source: 'lead_source', class_raw: 'class_raw', class_group: 'class_group', owner: 'owner_name',
  medium: 'last_touch_medium', source: 'last_touch_source', touch_point: 'last_touch_point', campaign: 'last_touch_campaign', staff: 'last_touch_staff',
};
const DIMS: Record<string, string> = {
  last_touch_point: 'last_touch_point', last_touch_source: 'last_touch_source', last_touch_medium: 'last_touch_medium', last_touch_campaign: 'last_touch_campaign',
  last_touch_staff: 'last_touch_staff', lead_stage: 'lead_stage', lead_source: 'lead_source', class_raw: 'class_raw', owner_name: 'owner_name',
};

/** payments-in-window semi-join (+ optional grade / course restriction) */
function payWindow(sql: Sql, p: Period, grades: string[], courses: string[], pm: PayMethod = 'all'): Frag {
  const gradeCond = grades.length ? sql`AND COALESCE(hp.grade_label, b.grade_title, 'No Grade On Batch') IN ${sql(grades)}` : sql``;
  const courseCond = courses.length ? sql`AND COALESCE(hp.course_label, analytics.course_label(b.title, b.course_title, COALESCE(hp.enrollment_batch_id, hp.batch_id))) IN ${sql(courses)}` : sql``;
  return sql`EXISTS (SELECT 1 FROM analytics.v_payment_all hp LEFT JOIN app.core_batch b ON b.id = COALESCE(hp.enrollment_batch_id, hp.batch_id)
                     WHERE hp.user_id = m.user_id AND ${VALID(sql, pm)} AND hp.payment_date BETWEEN ${p.from} AND ${p.to} ${gradeCond} ${courseCond})`;
}

/** grade / course restriction on a payment row (hp + b aliases): the page selector and the grade / course drill */
function payRestrict(sql: Sql, q: Record<string, string>, skip?: string): Frag {
  // skip = 'grade' / 'course': the card of that dimension ignores its own selection, so more rows can be picked
  const grades = skip === 'grade' ? [] : (q.grade ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  const courses = skip === 'course' ? [] : (q.course ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  if (q.dim === 'grade' && q.value !== undefined) grades.push(q.value);
  if (q.dim === 'course' && q.value !== undefined) courses.push(q.value);
  const c: Frag[] = [];
  if (grades.length) c.push(sql`COALESCE(hp.grade_label, b.grade_title, 'No Grade On Batch') IN ${sql(grades)}`);
  if (courses.length) c.push(sql`COALESCE(hp.course_label, analytics.course_label(b.title, b.course_title, COALESCE(hp.enrollment_batch_id, hp.batch_id))) IN ${sql(courses)}`);
  return c.reduce((a, x) => sql`${a} AND ${x}`, sql`true`);
}

function payerWhere(sql: Sql, f: Filters, p: Period, q: Record<string, string>, skip?: string): Frag {
  const grades = skip === 'grade' ? [] : (q.grade ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  const courses = skip === 'course' ? [] : (q.course ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  const pm = payMethod(q);
  const c: Frag[] = [payWindow(sql, p, grades, courses, pm)];
  if (f.dups !== '1') c.push(sql`true`);
  for (const k of LIST_KEYS) {
    const col = PAYER_COLS[k]; const vals = f[k];
    if (!col || !vals?.length || k === skip) continue;
    const hasNull = vals.includes('(null)'); const real = vals.filter((v) => v !== '(null)');
    const ref = sql`m.${sql(col)}`;
    if (hasNull && real.length) c.push(sql`(${ref} IN ${sql(real)} OR ${ref} IS NULL)`);
    else if (hasNull) c.push(sql`${ref} IS NULL`);
    else c.push(sql`${ref} IN ${sql(real)}`);
  }
  // drill-down dimension
  if (q.dim && q.value !== undefined) {
    if (q.dim === 'grade') c.push(payWindow(sql, p, [q.value], [], pm));
    else if (q.dim === 'course') c.push(payWindow(sql, p, [], [q.value], pm));
    else {
      const col = DIMS[q.dim];
      if (!col) throw Object.assign(new Error(`unknown dim ${q.dim}`), { status: 400 });
      c.push(q.value === '(null)' ? sql`m.${sql(col)} IS NULL` : sql`m.${sql(col)}::text = ${q.value}`);
    }
  }
  return c.reduce((a, x) => sql`${a} AND ${x}`, sql`true`);
}

export interface PayerDim { key: string; users: number; touches: number; revenue: number; new_users: number; share_pct: number | null }
async function byDim(sql: Sql, w: Frag, col: string, p: Period, limit = 2000): Promise<PayerDim[]> {
  const rows = await sql<Omit<PayerDim, 'share_pct'>[]>`
    SELECT COALESCE(m.${sql(col)}::text, '(null)') AS key, count(*)::int AS users, COALESCE(sum(m.touches_before_payment), 0)::int AS touches,
           COALESCE(sum(m.revenue), 0)::float8 AS revenue, count(*) FILTER (WHERE m.first_payment_date BETWEEN ${p.from} AND ${p.to})::int AS new_users
    FROM analytics.mv_payer m WHERE ${w} GROUP BY 1 ORDER BY users DESC LIMIT ${limit}`;
  const tot = rows.reduce((s, r) => s + r.users, 0);
  return rows.map((r) => ({ ...r, share_pct: pct(r.users, tot) }));
}

converted.get('/converted', (c) =>
  handle(c, async ({ sql, f, periods, q }) => {
    const p = periods.current;
    const w = payerWhere(sql, f, p, q);
    const wx = (skip: string) => payerWhere(sql, f, p, q, skip);   // a card never filters itself
    const pm = payMethod(q);
    const V = VALID(sql, pm);
    const R = payRestrict(sql, q);   // payments / revenue / course / grade / daily count only payments matching the grade or course selection
    const [[k], [pk], byStage, byPoint, bySource, byMedium, byCampaign, byStaff, byCourse, byGrade, daily, grades] = await Promise.all([
      sql<{ users: number; new_users: number; no_touch: number; no_lead: number; revenue: number; touches: number }[]>`
        SELECT count(*)::int AS users, count(*) FILTER (WHERE ${pm === 'm0' ? sql`m.first_payment_date_m0` : sql`m.first_payment_date`} BETWEEN ${p.from} AND ${p.to})::int AS new_users,
               count(*) FILTER (WHERE m.last_touch_id IS NULL)::int AS no_touch, count(*) FILTER (WHERE m.no_lead)::int AS no_lead,
               COALESCE(sum(m.revenue), 0)::float8 AS revenue, COALESCE(sum(m.touches_before_payment), 0)::int AS touches
        FROM analytics.mv_payer m WHERE ${w}`,
      sql<{ payments_all: number; revenue_all: number }[]>`
        SELECT count(*)::int AS payments_all, COALESCE(sum(hp.amount), 0)::float8 AS revenue_all
        FROM analytics.v_payment_all hp LEFT JOIN app.core_batch b ON b.id = COALESCE(hp.enrollment_batch_id, hp.batch_id) WHERE ${V} AND ${R} AND hp.payment_date BETWEEN ${p.from} AND ${p.to}
          AND hp.user_id IN (SELECT m.user_id FROM analytics.mv_payer m WHERE ${w})`,
      byDim(sql, wx('lead_stage'), 'lead_stage', p), byDim(sql, wx('touch_point'), 'last_touch_point', p), byDim(sql, wx('source'), 'last_touch_source', p), byDim(sql, wx('medium'), 'last_touch_medium', p),
      byDim(sql, wx('campaign'), 'last_touch_campaign', p), byDim(sql, wx('staff'), 'last_touch_staff', p),
      sql<PayerDim[]>`
        SELECT COALESCE(hp.course_label, analytics.course_label(b.title, b.course_title, COALESCE(hp.enrollment_batch_id, hp.batch_id))) AS key, count(DISTINCT hp.user_id)::int AS users, count(*)::int AS touches,
               COALESCE(sum(hp.amount), 0)::float8 AS revenue, 0::int AS new_users, NULL::float8 AS share_pct
        FROM analytics.v_payment_all hp LEFT JOIN app.core_batch b ON b.id = COALESCE(hp.enrollment_batch_id, hp.batch_id)
        WHERE ${V} AND ${payRestrict(sql, q, 'course')} AND hp.payment_date BETWEEN ${p.from} AND ${p.to} AND hp.user_id IN (SELECT m.user_id FROM analytics.mv_payer m WHERE ${wx('course')})
        GROUP BY 1 ORDER BY users DESC LIMIT 2000`,
      sql<PayerDim[]>`
        SELECT COALESCE(hp.grade_label, b.grade_title, 'No Grade On Batch') AS key, count(DISTINCT hp.user_id)::int AS users, count(*)::int AS touches,
               COALESCE(sum(hp.amount), 0)::float8 AS revenue, 0::int AS new_users, NULL::float8 AS share_pct
        FROM analytics.v_payment_all hp LEFT JOIN app.core_batch b ON b.id = COALESCE(hp.enrollment_batch_id, hp.batch_id)
        WHERE ${V} AND ${payRestrict(sql, q, 'grade')} AND hp.payment_date BETWEEN ${p.from} AND ${p.to} AND hp.user_id IN (SELECT m.user_id FROM analytics.mv_payer m WHERE ${wx('grade')})
        GROUP BY 1 ORDER BY users DESC`,
      sql<{ d: string; users: number; payments: number; revenue: number }[]>`
        SELECT hp.payment_date::text AS d, count(DISTINCT hp.user_id)::int AS users, count(*)::int AS payments, COALESCE(sum(hp.amount), 0)::float8 AS revenue
        FROM analytics.v_payment_all hp LEFT JOIN app.core_batch b ON b.id = COALESCE(hp.enrollment_batch_id, hp.batch_id) WHERE ${V} AND ${R} AND hp.payment_date BETWEEN ${p.from} AND ${p.to} AND hp.user_id IN (SELECT m.user_id FROM analytics.mv_payer m WHERE ${w})
        GROUP BY 1 ORDER BY 1`,
      sql<{ key: string }[]>`SELECT DISTINCT COALESCE(grade_title, 'No Grade On Batch') AS key FROM app.core_batch ORDER BY 1`,
    ]);
    return {
      period: p, pm,
      kpis: { ...k, ...pk, no_touch_pct: pct(k.no_touch, k.users), no_lead_pct: pct(k.no_lead, k.users) },
      by_stage: byStage, by_last_touch_point: byPoint, by_last_source: bySource, by_last_medium: byMedium, by_last_campaign: byCampaign, by_last_staff: byStaff,
      by_course: byCourse, by_grade: byGrade, daily, grades: grades.map((g) => g.key),
      definitions: {
        users: pm === 'm0'
          ? 'Distinct paying app users with a valid payment (payment_method 0, not deleted, is_success, payment_success) whose payment date is in the window. This counts paying app accounts, including people with no Salesforce lead.'
          : pm === 'm1'
            ? 'Paying users with a valid payment of payment_method 1 (gateway EMI instalments; every such row carries an emi_id) dated in the window.'
            : 'Distinct paying app users with ANY valid payment (any payment_method; not deleted, is_success, payment_success) dated in the window. Switch to "Method 0" to count payment_method 0 only, as the Overview does.',
        new_users: 'Paying users whose FIRST ever valid payment is inside the window (new customers).',
        no_touch: 'Users with no lead touch on/before their payment: no Salesforce lead on that phone, or all touches came after the payment. Shown as "No Touch Before Payment" in the tables.',
        no_lead: 'Paying users whose phone matches no Salesforce lead.',
        credit: 'Every user is credited to ONE touch: the latest touch dated on/before its last valid payment day, across all Salesforce leads with the same phone. If that last touch is an Eduport App touch made less than 2 hours before the payment, the credit goes to the touch before it; when the app touch is the only touch, it keeps the credit. Touch point, source, medium, campaign and staff come from that touch.',
        touches: 'Number of touches on/before the payment for the users in the row.',
        course: 'Users by the course they bought; a user buying two courses appears under both. The course is the one of the batch on the payment\x27s ENROLLMENT (where the student is enrolled now), with " - Fastrack" / " - Booster" added from the batch name; the batch written on the payment is used only when the enrollment has none.',
        grade: 'Grade of the course that was bought (batch of the payment\x27s enrollment), not the class recorded on the lead.',
        stage: 'Lead stage of the user\'s most recently created Salesforce lead (one lead per user).',
        revenue: 'Sum of payment amounts of the users in the row (all their valid payments, any method, any date).',
        pm: 'Payment method: "All" counts every successful payment; "Method 0" counts payment_method 0 only, the rule the Overview uses; "Method 1" is the rest (gateway EMI instalments). In the user list, course / grade / payments / revenue cover the payments inside the selected dates; the all-time columns cover every payment of the user.',
      },
    };
  }),
);

// ---------------------------------------------------------------- payer list (drill-down + CSV)
const SORTABLE: Record<string, string> = { last_payment_date: 'last_payment_date', first_payment_date: 'first_payment_date', revenue: 'revenue', payments: 'payments', touches_before_payment: 'touches_before_payment', last_touch_at: 'last_touch_at', lead_name: 'lead_name', lead_stage: 'lead_stage', class_raw: 'class_raw' };
const COLS = ['user_id', 'lead_name', 'first_name', 'last_name', 'mobile', 'email', 'lead_stage', 'class_raw', 'lead_source', 'owner_name', 'courses', 'grades', 'payments', 'first_payment_date', 'last_payment_date', 'revenue', 'payments_all_time', 'revenue_all_time', 'first_payment_ever',
  'last_touch_point', 'last_touch_source', 'last_touch_medium', 'last_touch_campaign', 'last_touch_staff', 'last_touch_at', 'touches_before_payment', 'no_lead', 'lead_id'];

function maskRow(r: Rec, role: Role): Rec {
  return { ...r, mobile: maskPhone(r.mobile as string | null, role), phone_key: maskPhone(r.phone_key as string | null, role), email: maskEmail(r.email as string | null, role), first_name: maskName(r.first_name as string | null, role), last_name: maskName(r.last_name as string | null, role) };
}
function searchCond(sql: Sql, s: string): Frag {
  s = s.trim(); if (!s) return sql`true`;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 5 && digits.length === s.length) return sql`(m.phone_key LIKE ${'%' + digits} OR m.user_id::text = ${digits})`;
  if (/^LM-\d+$/i.test(s)) return sql`upper(m.lead_name) = ${s.toUpperCase()}`;
  const like = `%${s.toLowerCase()}%`;
  return sql`(lower(l.first_name__c) LIKE ${like} OR lower(l.last_name__c) LIKE ${like} OR lower(l.email__c) LIKE ${like} OR lower(m.lead_name) LIKE ${like})`;
}
function listQuery(sql: Sql, f: Filters, p: Period, q: Record<string, string>, page: { limit: number; offset: number } | null) {
  const w = payerWhere(sql, f, p, q);
  const sortCol = SORTABLE[q.sort ?? ''] ?? 'last_payment_date';
  const dir = q.dir === 'asc' ? sql`ASC NULLS FIRST` : sql`DESC NULLS LAST`;
  // courses / grades / payments / dates / revenue = the user's payments INSIDE the selected dates (payment method switch and purchased grade /
  // course selection applied); the *_all_time columns keep the lifetime figures, so a returning customer is still recognisable
  return sql<Rec[]>`
    SELECT x.user_id, x.lead_name, x.first_name, x.last_name, x.mobile, x.email, x.lead_stage, x.class_raw, x.lead_source, x.owner_name,
           x.courses, x.grades, x.payments, x.first_payment_date::text AS first_payment_date, x.last_payment_date::text AS last_payment_date, x.revenue,
           x.payments_all_time, x.revenue_all_time, x.first_payment_ever::text AS first_payment_ever,
           x.last_touch_point, x.last_touch_source, x.last_touch_medium, x.last_touch_campaign, x.last_touch_staff, x.last_touch_at::text AS last_touch_at,
           x.touches_before_payment, x.no_lead, x.lead_id, count(*) OVER ()::int AS total_rows
    FROM (
      SELECT m.user_id, m.lead_name, l.first_name__c AS first_name, l.last_name__c AS last_name, u.phone AS mobile, l.email__c AS email,
             m.lead_stage, m.class_raw, m.lead_source, m.owner_name,
             pw.courses, pw.grades, pw.payments, pw.first_payment_date, pw.last_payment_date, pw.revenue,
             m.payments AS payments_all_time, m.revenue::float8 AS revenue_all_time, m.first_payment_date AS first_payment_ever,
             m.last_touch_point, m.last_touch_source, m.last_touch_medium, m.last_touch_campaign, m.last_touch_staff, m.last_touch_at,
             m.touches_before_payment, m.no_lead, m.lead_id
      FROM analytics.mv_payer m
      LEFT JOIN salesforce.lead_master__c l ON l.id = m.lead_id
      LEFT JOIN app.home_customuser u ON u.id = m.user_id
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT COALESCE(b.title, hp.course_label, 'batch ' || COALESCE(hp.enrollment_batch_id, hp.batch_id)::text), ' | ') AS courses,
               string_agg(DISTINCT COALESCE(hp.grade_label, b.grade_title, 'No Grade On Batch'), ' | ') AS grades,
               count(*)::int AS payments, min(hp.payment_date) AS first_payment_date, max(hp.payment_date) AS last_payment_date, sum(hp.amount)::float8 AS revenue
        FROM analytics.v_payment_all hp LEFT JOIN app.core_batch b ON b.id = COALESCE(hp.enrollment_batch_id, hp.batch_id)
        WHERE hp.user_id = m.user_id AND ${VALID(sql, payMethod(q))} AND hp.payment_date BETWEEN ${p.from} AND ${p.to} AND ${payRestrict(sql, q)}) pw ON true
      WHERE ${w} AND ${searchCond(sql, q.q ?? '')}
    ) x
    ORDER BY x.${sql(sortCol)} ${dir}, x.user_id
    ${page ? sql`LIMIT ${page.limit} OFFSET ${page.offset}` : sql``}`;
}

converted.get('/converted/users', (c) =>
  handle(c, async ({ sql, f, periods, q, role }) => {
    const limit = intParam(q, 'limit', 50, 1, 200);
    const page = intParam(q, 'page', 1, 1, 100000);
    const rows = await listQuery(sql, f, periods.current, q, { limit, offset: (page - 1) * limit });
    const total = rows.length ? (rows[0].total_rows as number) : 0;
    return { page, limit, total, rows: rows.map((r) => { const { total_rows: _t, ...rest } = maskRow(r, role); return rest; }), masked: role === 'viewer', columns: COLS };
  }, 0),
);

converted.get('/converted/users.csv', async (c) => {
  const q = c.req.query(); const f = parseFilters(q); const periods = resolvePeriods(f); const role = c.get('user').role;
  const cap = Number.parseInt(c.env.EXPORT_ROW_CAP ?? '50000', 10) || 50000;
  return csvStream(c, { cols: COLS, cap, filename: `converted_users_${periods.current.from}_${periods.current.to}.csv`, mask: (r) => maskRow(r, role),
    fetchPage: (sql, limit, offset) => listQuery(sql, f, periods.current, q, { limit, offset }) });
});
