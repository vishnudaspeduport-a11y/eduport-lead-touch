/**
 * Plain-words definition + the SQL behind every KPI card ("?" popover).
 * `${where}` stands for the shared filter WHERE clause built by filters.ts.
 */
export interface Definition { key: string; title: string; plain: string; sql: string; deviation?: string; }

const L = 'FROM analytics.mv_lead_base l WHERE ${where}';
const T = 'FROM analytics.mv_touch_base t WHERE ${touch_where}';

export const DEFINITIONS: Definition[] = [
  { key: 'leads', title: 'Total Leads',
    plain: 'Distinct Lead_Master__c rows in the date window (by lead created date, or by touch / payment date when the basis toggle is switched). Deleted leads are always excluded; duplicates are excluded unless the toggle is on.',
    sql: `SELECT count(*) ${L}` },
  { key: 'touches', title: 'Total Touches',
    plain: 'Distinct Lead_Touch__c rows (IsDeleted = false, lead exists) belonging to the leads in the window. On the "touch date" basis only touches inside the window count.',
    sql: `SELECT count(*) ${T}`,
    deviation: 'Basis: touches of leads created in the window (default). Switch basis to "touch date" to count by Touch_Date__c.' },
  { key: 'touches_per_lead', title: 'Touches per Lead', plain: 'Total touches divided by total leads.', sql: 'touches / leads' },
  { key: 'converted', title: 'Converted Leads',
    plain: 'Leads with at least one valid payment matched on the normalised phone (last 10 digits). Valid = payment_method 0, not deleted, is_success, payment_success, user not deleted. converted_at = earliest valid payment_date.',
    sql: `SELECT count(*) FILTER (WHERE converted) ${L}` },
  { key: 'conv_rate', title: 'Conversion %', plain: 'Converted leads / total leads.', sql: `SELECT count(*) FILTER (WHERE converted)::float / count(*) ${L}` },
  { key: 'avg_touches_to_convert', title: 'Avg Touches to Convert',
    plain: 'For converted leads: number of touches with touch date (IST) on or before the payment date. Touches after payment are excluded. Zero-touch conversions count as 0 and are shown as "unattributed".',
    sql: `SELECT avg(valid_touches) FILTER (WHERE converted) ${L}`,
    deviation: 'touch_date <= payment_date compared at IST calendar-day granularity (same-day touches count).' },
  { key: 'median_touches_to_convert', title: 'Median Touches to Convert', plain: 'Median of the same per-lead count.',
    sql: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY valid_touches) FILTER (WHERE converted) ${L}` },
  { key: 'avg_days_to_convert', title: 'Avg Days to Convert',
    plain: 'Converted leads: earliest valid payment date minus lead created date (IST). Negative values (payment before lead creation = pre-existing customer) are excluded from the average.',
    sql: `SELECT avg(days_to_convert) FILTER (WHERE converted AND days_to_convert >= 0) ${L}` },
  { key: 'revenue', title: 'Revenue', plain: 'Sum of home_payment.total over all valid payments matched to the leads in the window.', sql: `SELECT sum(revenue) ${L}` },
  { key: 'revenue_per_lead', title: 'Revenue per Lead', plain: 'Revenue / total leads.', sql: 'revenue / leads' },
  { key: 'first_touch_conversions', title: 'First-Touch Conversions',
    plain: 'Converted leads whose earliest touch is on or before the payment date. Credit goes to that first touch\'s touch point / source / medium / campaign.',
    sql: `SELECT count(*) FILTER (WHERE first_touch_conversion) ${L}` },
  { key: 'last_touch_conversions', title: 'Last-Touch Conversions',
    plain: 'Converted leads with at least one touch on or before the payment date; credit goes to the latest such touch. Same count as first-touch conversions by construction; the split by channel differs.',
    sql: `SELECT count(*) FILTER (WHERE last_touch_conversion) ${L}` },
  { key: 'unattributed', title: 'Unattributed Conversions',
    plain: 'Converted leads with NO touch on or before the payment date (never touched, or every touch came after the payment - typically pre-existing customers).',
    sql: `SELECT count(*) FILTER (WHERE unattributed_conversion) ${L}` },
  { key: 'contact_rate', title: 'Contact Rate', plain: 'Leads with at least one touch / total leads.', sql: `SELECT count(*) FILTER (WHERE contacted)::float / count(*) ${L}` },
  { key: 'response_hours', title: 'Median Response Time', plain: 'Median hours between lead creation and the first touch.', sql: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY response_hours) ${L}` },
  { key: 'attribution_linear', title: 'Linear attribution', plain: 'Each pre-conversion touch of a converted lead gets 1/n credit.', sql: `SELECT dim, sum(credit_linear) ${T} GROUP BY dim` },
  { key: 'attribution_position', title: 'Position-based (40/20/40)', plain: 'First touch 40%, last touch 40%, the remaining 20% split evenly across middle touches. 1 touch = 100%, 2 touches = 50/50.', sql: `SELECT dim, sum(credit_position) ${T} GROUP BY dim` },
];
