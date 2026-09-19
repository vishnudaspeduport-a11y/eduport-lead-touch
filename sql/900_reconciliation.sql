-- =====================================================================
-- 900_reconciliation.sql
-- Fixed window 2026-03-01 .. 2026-08-31 (IST calendar dates), NO filters
-- except the always-on exclusions (Is_Deleted__c / IsDeleted) and the
-- default "duplicates excluded" toggle. Each block is the exact SQL the
-- API runs for that KPI (mv_* are snapshots of v_* - same definitions).
--
--   psql "$RO_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/900_reconciliation.sql
--
-- Compare against the Tableau "Lead Touch Combined" workbook. Deviations
-- from the brief are listed at the bottom of this file and in README.
-- =====================================================================
\set from '2026-03-01'
\set to   '2026-08-31'
\timing on

\echo '--- A. Total leads (Lead_Master__c grain, created in window, dups excluded)'
SELECT count(*)::int AS total_leads
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate;

\echo '--- A2. Same, duplicates INCLUDED (for the toggle)'
SELECT count(*)::int AS total_leads_incl_dups
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to';

\echo '--- B. Total touches (two bases - the workbook most likely uses B1)'
\echo '    B1: touches whose Touch_Date__c falls in the window (any lead, lead not deleted)'
SELECT count(*)::int AS total_touches_by_touch_date,
       count(*) FILTER (WHERE t.is_pre_conversion)::int AS pre_conversion_touches
FROM analytics.mv_touch_base t
WHERE t.touch_date BETWEEN :'from' AND :'to' AND NOT t.is_duplicate;

\echo '    B2: all touches belonging to leads CREATED in the window (default API basis = created)'
SELECT count(*)::int AS total_touches_of_window_leads,
       count(*) FILTER (WHERE t.is_pre_conversion)::int AS pre_conversion_touches
FROM analytics.mv_touch_base t
WHERE t.lead_created_date BETWEEN :'from' AND :'to' AND NOT t.is_duplicate;

\echo '--- C. Converted leads, conversion %, revenue'
SELECT count(*)::int                                   AS total_leads,
       count(*) FILTER (WHERE converted)::int          AS converted_leads,
       round(100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0), 3) AS conversion_pct,
       count(*) FILTER (WHERE converted AND NOT pre_existing_customer)::int AS converted_excl_pre_existing,
       sum(revenue) FILTER (WHERE converted)::numeric(18,2) AS revenue,
       count(*) FILTER (WHERE sf_is_converted)::int    AS sf_is_converted_flag_count   -- Salesforce's own flag, for reference
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate;

\echo '--- D. Touches to convert (valid touches with touch_date <= payment_date, converted leads only)'
SELECT round(avg(valid_touches), 3)                                            AS avg_touches_to_convert,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY valid_touches)              AS median_touches_to_convert,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY valid_touches)              AS p90_touches_to_convert,
       round(avg(valid_touches) FILTER (WHERE valid_touches > 0), 3)           AS avg_touches_to_convert_excl_zero_touch
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate AND l.converted;

\echo '--- D2. Touch-count bucket distribution (converted leads)'
SELECT touch_bucket, count(*)::int AS converted_leads
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate AND l.converted
GROUP BY touch_bucket ORDER BY CASE touch_bucket WHEN '6+' THEN 6 ELSE touch_bucket::int END;

\echo '--- E. First-touch / last-touch conversions'
\echo '    A conversion is first-/last-touch attributable when the lead has >= 1 touch on/before payment.'
SELECT count(*) FILTER (WHERE first_touch_conversion)::int   AS first_touch_conversions,
       count(*) FILTER (WHERE last_touch_conversion)::int    AS last_touch_conversions,
       count(*) FILTER (WHERE unattributed_conversion)::int  AS unattributed_conversions,
       count(*) FILTER (WHERE converted)::int                AS converted_leads
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate;

\echo '--- E2. First-touch conversions by first touch point (credit = 1 per converted lead)'
SELECT first_touch_point, count(*)::int AS first_touch_conversions, sum(revenue)::numeric(18,2) AS revenue
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate AND l.first_touch_conversion
GROUP BY 1 ORDER BY 2 DESC;

\echo '--- E3. Last-touch conversions by last touch point'
SELECT last_touch_point, count(*)::int AS last_touch_conversions, sum(revenue)::numeric(18,2) AS revenue
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate AND l.last_touch_conversion
GROUP BY 1 ORDER BY 2 DESC;

\echo '--- E4. Credit totals must equal converted attributable leads (sanity)'
SELECT round(sum(credit_first))  AS first_credit,
       round(sum(credit_last))   AS last_credit,
       round(sum(credit_linear)) AS linear_credit,
       round(sum(credit_position)) AS position_credit
FROM analytics.mv_touch_base t
WHERE t.lead_created_date BETWEEN :'from' AND :'to' AND NOT t.is_duplicate;

\echo '--- F. Avg days to convert'
SELECT round(avg(days_to_convert), 2) AS avg_days_to_convert,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_convert) AS median_days_to_convert
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN :'from' AND :'to' AND NOT l.is_duplicate AND l.converted AND l.days_to_convert >= 0;

\echo '--- G. Valid payments in window (payment grain, independent of leads) - for the payment-date basis'
SELECT count(*)::int AS valid_payments, count(DISTINCT user_id)::int AS paying_users, sum(total)::numeric(18,2) AS revenue
FROM analytics.v_valid_payment WHERE payment_date BETWEEN :'from' AND :'to';

\echo '--- H. Leads converted by PAYMENT DATE in window (basis = payment)'
SELECT count(*)::int AS leads_converted_in_window, sum(revenue)::numeric(18,2) AS revenue
FROM analytics.mv_lead_base l
WHERE l.converted AND l.converted_at BETWEEN :'from' AND :'to' AND NOT l.is_duplicate;

\echo '--- I. class_group self-test (all rows must be ok = t)'
SELECT * FROM analytics.class_group_selftest() WHERE NOT ok;

-- ---------------------------------------------------------------------
-- DELIBERATE DEVIATIONS / INTERPRETATIONS (flagged, not silently applied)
-- 1. touch_date <= payment_date is compared at IST calendar-day granularity
--    (analytics.ist_date(Touch_Date__c) <= payment_date). payment_date is a
--    DATE, so a same-day touch counts as pre-conversion. If Tableau compared
--    the raw datetime to midnight, same-day touches would be excluded.
-- 2. Class group adds 'Plus Two Completed' and 'Unknown' buckets (see 002).
-- 3. "Total touches" default basis counts touches of leads created in the
--    window (B2). B1 (by touch date) is also reported; the UI toggle switches.
-- 4. Conversion includes pre-existing customers (payment before lead
--    creation) exactly as the workbook; converted_excl_pre_existing is shown
--    alongside for reference only.
-- 5. Paid/organic split, response time, contact rate, cohorts, stale leads
--    are app additions and have no Tableau counterpart.
-- ---------------------------------------------------------------------
