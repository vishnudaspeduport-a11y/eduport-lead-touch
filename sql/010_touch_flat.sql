-- =====================================================================
-- 010_touch_flat.sql  (2026-09-22)  Touch-grain analytics table for the Overview
-- One precomputed table only: one row per valid touch with the lead attributes the
-- Overview needs. Everything on the page is an aggregate of this table (plus the
-- interested-course table for the IC funnel). ~85k rows, ~40 MB with indexes.
-- Re-runnable: drops and recreates the two base views (adds class_raw / lm_reason to
-- the touch view) and the materialized table.
-- =====================================================================
SET search_path = analytics, public;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_touch_flat;
DROP VIEW IF EXISTS analytics.v_lead_base;
DROP VIEW IF EXISTS analytics.v_touch_base;

CREATE VIEW analytics.v_touch_base AS
WITH tv AS (
  SELECT
    t.id                                AS touch_id,
    t.lead_master__c                    AS lead_id,
    t.touch_date__c                     AS touch_at,
    analytics.ist_date(t.touch_date__c) AS touch_date,
    COALESCE(NULLIF(btrim(t.touch_point__c),''), '(blank)') AS touch_point,
    COALESCE(NULLIF(btrim(t.source__c),''),      '(blank)') AS source,
    COALESCE(NULLIF(btrim(t.medium__c),''),      '(blank)') AS medium,
    COALESCE(NULLIF(btrim(t.campaign__c),''),    '(blank)') AS campaign,
    t.adset_name__c                     AS adset_name,
    t.ad_name__c                        AS ad_name,
    t.platform_id__c                    AS platform_id,
    NULLIF(btrim(t.staff__c),'')        AS staff,
    t.is_first_touch__c                 AS sf_is_first_touch,
    t.is_last_touch__c                  AS sf_is_last_touch,
    t.is_first_of_type__c               AS sf_is_first_of_type,
    COALESCE(t.is_converted__c,false)   AS sf_is_converted,
    t.converted_date__c                 AS sf_converted_at,
    COALESCE(t.was_customer_at_touch__c,false) AS sf_was_customer_at_touch,
    t.attribution_credit__c             AS sf_attribution_credit,
    t.credit_value__c                   AS sf_credit_value,
    t.ic_status__c                      AS ic_status,
    t.ic_course__c                      AS touch_ic_course,
    t.multiple_ics__c                   AS multiple_ics,
    t.createddate                       AS touch_created_at,
    analytics.is_paid_touch(t.touch_point__c, t.source__c, t.medium__c) AS is_paid_touch,
    c.created_at                        AS lead_created_at,
    c.created_date                      AS lead_created_date,
    c.lead_source, c.class_group, c.lead_stage, c.lead_type, c.priority,
    c.district, c.city, c.owner_id, c.owner_name, c.campaign_quality,
    c.app_engagement_tier, c.ic_course, c.best_ic_status, c.is_duplicate, c.is_paid_lead,
    c.converted, c.converted_at, c.revenue, c.pre_existing_customer,
    (c.converted_at IS NULL OR analytics.ist_date(t.touch_date__c) <= c.converted_at) AS is_pre_conversion,
    c.last_payment_date,
    c.app_user_id,
    -- Tableau workbook 'Converted': ANY valid payment dated on/after the touch day
    COALESCE(c.last_payment_date >= analytics.ist_date(t.touch_date__c), false) AS tab_converted,
    c.courses,
    c.class_raw, c.lm_reason, c.sf_is_converted AS lead_sf_is_converted, c.sf_touch_count, c.lead_name
  FROM salesforce.lead_touch__c t
  JOIN analytics.v_lead_conv c ON c.lead_id = t.lead_master__c
  WHERE COALESCE(t.isdeleted,false) = false
    AND t.touch_date__c IS NOT NULL
),
seq AS (
  SELECT tv.*,
    row_number() OVER w_all                                   AS touch_seq_all,
    count(*)     OVER (PARTITION BY lead_id)                  AS n_touches_all,
    lag(touch_at) OVER w_all                                  AS prev_touch_at,
    CASE WHEN is_pre_conversion THEN
      row_number() OVER (PARTITION BY lead_id, is_pre_conversion ORDER BY touch_at, touch_id) END AS touch_seq,
    CASE WHEN is_pre_conversion THEN
      count(*) OVER (PARTITION BY lead_id, is_pre_conversion) END AS n_pre_touches,
    min(touch_at) FILTER (WHERE touch_date >= DATE '2026-03-01') OVER (PARTITION BY lead_id) AS tab_first_since_mar_at,
    max(touch_at) OVER (PARTITION BY lead_id)                                              AS tab_last_any_at,
    max(touch_at) FILTER (WHERE last_payment_date IS NOT NULL AND touch_date <= last_payment_date) OVER (PARTITION BY lead_id) AS tab_last_valid_at
  FROM tv
  WINDOW w_all AS (PARTITION BY lead_id ORDER BY touch_at, touch_id)
)
SELECT s.*,
  (s.touch_at = COALESCE(s.tab_first_since_mar_at, s.tab_last_any_at))           AS tab_is_first_touch,   -- workbook "Is Selected First Touch"
  (s.tab_last_valid_at IS NOT NULL AND s.touch_at = s.tab_last_valid_at)          AS tab_is_last_touch,    -- workbook "Is Last Touch"
  (s.touch_seq = 1)                                         AS is_first_touch,
  (s.touch_seq = s.n_pre_touches)                           AS is_last_touch,
  round((EXTRACT(epoch FROM s.touch_at - s.prev_touch_at) / 3600)::numeric, 2) AS gap_hours_from_prev,
  analytics.gap_bucket((EXTRACT(epoch FROM s.touch_at - s.prev_touch_at) / 3600)::numeric) AS gap_bucket,
  EXTRACT(dow  FROM s.touch_at AT TIME ZONE 'Asia/Kolkata')::int AS touch_dow,
  EXTRACT(hour FROM s.touch_at AT TIME ZONE 'Asia/Kolkata')::int AS touch_hour,
  CASE WHEN s.converted AND s.is_pre_conversion AND s.touch_seq = 1               THEN 1.0 ELSE 0 END::numeric(8,5) AS credit_first,
  CASE WHEN s.converted AND s.is_pre_conversion AND s.touch_seq = s.n_pre_touches THEN 1.0 ELSE 0 END::numeric(8,5) AS credit_last,
  CASE WHEN s.converted AND s.is_pre_conversion THEN 1.0 / s.n_pre_touches ELSE 0 END::numeric(8,5)       AS credit_linear,
  CASE WHEN s.converted AND s.is_pre_conversion THEN
         CASE WHEN s.n_pre_touches = 1 THEN 1.0
              WHEN s.n_pre_touches = 2 THEN 0.5
              WHEN s.touch_seq = 1 OR s.touch_seq = s.n_pre_touches THEN 0.4
              ELSE 0.2 / (s.n_pre_touches - 2) END
       ELSE 0 END::numeric(8,5)                                                                          AS credit_position
FROM seq s;

-- v_lead_base unchanged in meaning (recreated because it depends on v_touch_base)
CREATE VIEW analytics.v_lead_base AS
WITH ta AS (
  SELECT
    lead_id,
    count(*)                                              AS total_touches,
    count(*) FILTER (WHERE is_pre_conversion)             AS valid_touches,
    count(*) FILTER (WHERE is_paid_touch)                 AS paid_touches,
    count(DISTINCT touch_point)                           AS distinct_touch_points,
    count(DISTINCT staff) FILTER (WHERE staff IS NOT NULL) AS distinct_staff,
    min(touch_at)                                         AS first_touch_at,
    max(touch_at) FILTER (WHERE is_pre_conversion)        AS last_touch_at,
    max(touch_at)                                         AS last_touch_any_at,
    max(touch_point) FILTER (WHERE touch_seq_all = 1)     AS first_touch_point,
    max(source)      FILTER (WHERE touch_seq_all = 1)     AS first_touch_source,
    max(medium)      FILTER (WHERE touch_seq_all = 1)     AS first_touch_medium,
    max(campaign)    FILTER (WHERE touch_seq_all = 1)     AS first_touch_campaign,
    max(staff)       FILTER (WHERE touch_seq_all = 1)     AS first_touch_staff,
    max(touch_point) FILTER (WHERE is_last_touch)         AS last_touch_point,
    max(source)      FILTER (WHERE is_last_touch)         AS last_touch_source,
    max(medium)      FILTER (WHERE is_last_touch)         AS last_touch_medium,
    max(campaign)    FILTER (WHERE is_last_touch)         AS last_touch_campaign,
    max(staff)       FILTER (WHERE is_last_touch)         AS last_touch_staff,
    max(touch_point) FILTER (WHERE touch_seq_all = n_touches_all) AS last_touch_any_point,
    avg(gap_hours_from_prev) FILTER (WHERE is_pre_conversion)     AS avg_gap_hours
  FROM analytics.v_touch_base
  GROUP BY lead_id
)
SELECT
  c.*,
  COALESCE(ta.total_touches,0)::int      AS total_touches,
  COALESCE(ta.valid_touches,0)::int      AS valid_touches,
  COALESCE(ta.paid_touches,0)::int       AS paid_touches,
  COALESCE(ta.distinct_touch_points,0)::int AS distinct_touch_points,
  COALESCE(ta.distinct_staff,0)::int     AS distinct_staff,
  analytics.touch_bucket(COALESCE(ta.valid_touches,0)::int) AS touch_bucket,
  ta.first_touch_at,
  analytics.ist_date(ta.first_touch_at)  AS first_touch_date,
  ta.first_touch_point, ta.first_touch_source, ta.first_touch_medium, ta.first_touch_campaign, ta.first_touch_staff,
  ta.last_touch_at,
  analytics.ist_date(ta.last_touch_at)   AS last_touch_date,
  ta.last_touch_point, ta.last_touch_source, ta.last_touch_medium, ta.last_touch_campaign, ta.last_touch_staff,
  ta.last_touch_any_at, ta.last_touch_any_point,
  ta.avg_gap_hours,
  (COALESCE(ta.valid_touches,0) > 0)     AS attributable,
  (c.converted AND COALESCE(ta.valid_touches,0) > 0) AS first_touch_conversion,
  (c.converted AND COALESCE(ta.valid_touches,0) > 0) AS last_touch_conversion,
  (c.converted AND COALESCE(ta.valid_touches,0) = 0) AS unattributed_conversion,
  round((EXTRACT(epoch FROM ta.first_touch_at - c.created_at) / 3600)::numeric, 2) AS response_hours,
  (ta.first_touch_at IS NOT NULL)        AS contacted,
  (c.converted AND ta.first_touch_at IS NOT NULL AND c.converted_at < analytics.ist_date(ta.first_touch_at)) AS paid_before_first_touch,
  (c.sf_touch_count IS DISTINCT FROM COALESCE(ta.total_touches,0)::double precision) AS sf_touch_count_mismatch,
  (c.sf_is_converted IS DISTINCT FROM c.converted) AS sf_converted_mismatch,
  CASE WHEN NOT c.converted AND c.lead_stage NOT IN ('Converted','Disqualified') THEN true ELSE false END AS is_open
FROM analytics.v_lead_conv c
LEFT JOIN ta ON ta.lead_id = c.lead_id;

-- The one precomputed table
CREATE MATERIALIZED VIEW analytics.mv_touch_flat AS
SELECT touch_id, lead_id, lead_name, touch_at, touch_date, touch_point, source, medium, campaign, adset_name, ad_name, staff,
       lead_created_date, lead_source, class_raw, class_group, lead_stage, lead_type, priority, district, city, owner_name,
       campaign_quality, app_engagement_tier, best_ic_status, lm_reason, is_duplicate, is_paid_lead, is_paid_touch,
       lead_sf_is_converted, sf_touch_count, converted, converted_at, last_payment_date, tab_converted, courses, app_user_id, revenue, pre_existing_customer, is_pre_conversion,
       touch_seq, n_pre_touches, touch_seq_all, n_touches_all, is_first_touch, is_last_touch, tab_is_first_touch, tab_is_last_touch,
       credit_first, credit_last, credit_linear, credit_position, gap_hours_from_prev, gap_bucket, touch_dow, touch_hour
FROM analytics.v_touch_base
WITH NO DATA;
CREATE UNIQUE INDEX mv_touch_flat_pk   ON analytics.mv_touch_flat (touch_id);
CREATE INDEX mv_touch_flat_date        ON analytics.mv_touch_flat (touch_date);
CREATE INDEX mv_touch_flat_lead        ON analytics.mv_touch_flat (lead_id);

CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE t0 timestamptz; n bigint;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN RAISE NOTICE 'refresh_all already running'; RETURN; END IF;
  BEGIN
    t0 := clock_timestamp();
    n := analytics.refresh_one('analytics.mv_touch_flat'::regclass);
    view_name := 'analytics.mv_touch_flat'; row_count := n; seconds := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all')); RAISE; END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;

SELECT * FROM analytics.refresh_all();
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_total;
