-- =====================================================================
-- 910_explain.sql - EXPLAIN (ANALYZE, BUFFERS) for the heaviest queries.
-- Run after the MVs are populated:
--   psql "$RO_DATABASE_URL" -f sql/910_explain.sql
-- Target: < 2 s on the default 30-day view. The API never hits the base
-- tables for aggregates, so the heavy work is (a) the MV refresh and
-- (b) the attribution / touch-curve scans below.
-- =====================================================================
\timing on

\echo '=== 1. MV refresh cost: v_lead_base full build (runs on the cron, not per request)'
EXPLAIN (ANALYZE, BUFFERS, SUMMARY)
SELECT count(*) FROM analytics.v_lead_base;

\echo '=== 2. Default 30-day KPI query (mv_lead_base)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)::int AS leads,
       count(*) FILTER (WHERE converted)::int AS converted,
       sum(revenue)::float8 AS revenue,
       count(*) FILTER (WHERE first_touch_conversion)::int AS first_touch_conversions,
       count(*) FILTER (WHERE last_touch_conversion)::int AS last_touch_conversions,
       avg(valid_touches) FILTER (WHERE converted)::float8 AS avg_touches_to_convert,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY valid_touches) FILTER (WHERE converted)::float8 AS median_touches_to_convert,
       avg(days_to_convert) FILTER (WHERE converted AND days_to_convert >= 0)::float8 AS avg_days_to_convert
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN current_date - 29 AND current_date AND NOT l.is_duplicate;

\echo '=== 3. Attribution by touch point, 30-day window (mv_touch_base with lead-set subquery)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.touch_point,
       sum(credit_first)::float8 AS first_touch, sum(credit_last)::float8 AS last_touch,
       sum(credit_linear)::float8 AS linear, sum(credit_position)::float8 AS position_based,
       sum(credit_last * revenue)::float8 AS revenue_last, count(*)::int AS touches
FROM analytics.mv_touch_base t
WHERE t.lead_id IN (SELECT l.lead_id FROM analytics.mv_lead_base l
                    WHERE l.created_date BETWEEN current_date - 29 AND current_date AND NOT l.is_duplicate)
GROUP BY 1 ORDER BY 3 DESC;

\echo '=== 4. Lead explorer page (sorted, paginated, with a touch-level filter)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT l.lead_id, l.lead_name, l.created_date, l.lead_source, l.class_group, l.lead_stage, l.owner_name,
       l.valid_touches, l.converted, l.converted_at, l.revenue
FROM analytics.mv_lead_base l
WHERE l.created_date BETWEEN current_date - 29 AND current_date AND NOT l.is_duplicate
  AND EXISTS (SELECT 1 FROM analytics.mv_touch_base t WHERE t.lead_id = l.lead_id AND t.touch_point IN ('Meta Ad','Eduport App'))
ORDER BY l.created_at DESC
LIMIT 50 OFFSET 0;

\echo '=== 5. Cohort triangle, last 12 months'
EXPLAIN (ANALYZE, BUFFERS)
SELECT date_trunc('month', created_date)::date AS cohort,
       count(*)::int AS leads,
       count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 7)::int  AS c7,
       count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 30)::int AS c30,
       count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 90)::int AS c90,
       count(*) FILTER (WHERE converted)::int AS c_all
FROM analytics.mv_lead_base
WHERE created_date >= date_trunc('month', current_date)::date - interval '12 months' AND NOT is_duplicate
GROUP BY 1 ORDER BY 1;

\echo '=== 6. Phone-key join (the expensive part of the refresh) - verifies the expression indexes are used'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM salesforce.lead_master__c l
JOIN app.home_customuser u ON analytics.phone_key(u.phone) = analytics.phone_key(l.mobile_number__c)
WHERE l.createddate >= now() - interval '30 days' AND u.is_deleted = false;
