-- =====================================================================
-- 003_views.sql   (run as postgres in the Supabase SQL editor, after 002)
--
-- Layering (each layer only reads the one above it):
--   v_valid_payment   valid payments + normalised phone key
--   v_lead_payment    per-lead conversion (earliest valid payment, revenue)
--   v_lead_conv       one row per lead (Lead_Master__c grain) + conversion columns
--   v_touch_base      one row per valid touch + lead attributes + attribution credits
--   v_lead_base       v_lead_conv + touch aggregates (first/last touch, counts)
--
-- Authority order: Lead_Master__c is the grain for anything "per lead".
-- Lead_Touch__c is only joined for touch/attribution questions.
-- Leads are never counted from Lead_Touch__c.
--
-- Time zone: Salesforce datetimes are UTC. All calendar dates are IST
-- (analytics.ist_date) so that they line up with home_payment.payment_date.
-- =====================================================================
SET search_path = analytics, public;

-- ---------------------------------------------------------------------
-- Valid payment (exact port of the Tableau definition)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_valid_payment AS
SELECT
  p.id                              AS payment_id,
  p.user_id,
  analytics.phone_key(u.phone)      AS phone_key,
  p.payment_date,
  p.payment_time,
  p.created                         AS payment_created,
  p.total,
  p.amount,
  p.tuition_fees,
  p.discount,
  p.refund_amount,
  p.course_id,
  p.course_new_id,
  p.batch_id,
  p.sales_person_id,
  p.enrollment_id,
  p.payment_type
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.payment_method  = 0
  AND p.deleted         = false
  AND p.is_success      = true
  AND p.payment_success = true
  AND u.is_deleted      = false
  AND p.payment_date IS NOT NULL;

-- ---------------------------------------------------------------------
-- Per-lead conversion. A lead is converted when ANY valid payment matches
-- on the normalised phone. converted_at = earliest valid payment_date.
-- (Pre-existing customers - payment before the lead was created - are still
--  "converted" per the workbook; v_lead_conv.pre_existing_customer flags them.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lead_payment AS
SELECT
  l.id                            AS lead_id,
  MIN(vp.payment_date)            AS converted_at,
  MIN(vp.payment_time)            AS first_payment_time,
  COUNT(*)                        AS payment_count,
  SUM(vp.total)                   AS revenue,
  SUM(COALESCE(vp.refund_amount,0)) AS refunds,
  MIN(vp.user_id)                 AS app_user_id
FROM salesforce.lead_master__c l
JOIN analytics.v_valid_payment vp
  ON vp.phone_key = analytics.phone_key(l.mobile_number__c)
GROUP BY l.id;

-- ---------------------------------------------------------------------
-- One row per lead (no touch data yet)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lead_conv AS
SELECT
  l.id                                   AS lead_id,
  l.name                                 AS lead_name,
  l.createddate                          AS created_at,
  analytics.ist_date(l.createddate)      AS created_date,
  l.first_name__c                        AS first_name,
  l.last_name__c                         AS last_name,
  l.mobile_number__c                     AS mobile,
  l.email__c                             AS email,
  analytics.phone_key(l.mobile_number__c) AS phone_key,
  analytics.phone_key_valid(l.mobile_number__c) AS phone_valid,
  l.class__c                             AS class_raw,
  analytics.class_group(l.class__c)      AS class_group,
  COALESCE(NULLIF(btrim(l.lead_source__c),''), '(blank)') AS lead_source,
  l.lead_source_detail__c                AS lead_source_detail,
  COALESCE(NULLIF(btrim(l.lead_stage__c),''), '(blank)')  AS lead_stage,
  l.lead_type__c                         AS lead_type,
  l.priority__c                          AS priority,
  l.district__c                          AS district,
  l.city__c                              AS city,
  l.state__c                             AS state,
  l.campaign_name__c                     AS campaign_name,
  l.campaign_quality__c                  AS campaign_quality,
  l.campaign_tag__c                      AS campaign_tag,
  l.campaign_date__c                     AS campaign_date,
  l.ad_platform__c                       AS ad_platform,
  l.ad_campaign__c                       AS ad_campaign,
  l.ad_set__c                            AS ad_set,
  l.ad_name__c                           AS ad_name,
  l.ad_class__c                          AS ad_class,
  l.ad_class_match__c                    AS ad_class_match,
  l.ownerid                              AS owner_id,
  COALESCE(u.name, l.ownerid)            AS owner_name,
  l.enquiry_assigned_date__c             AS enquiry_assigned_date,
  l.follow_up_date__c                    AS follow_up_date,
  l.next_followup_due__c                 AS next_followup_due,
  l.touch_count__c                       AS sf_touch_count,
  l.first_touch_date__c                  AS sf_first_touch_at,
  l.first_touch_point__c                 AS sf_first_touch_point,
  l.last_touch_date__c                   AS sf_last_touch_at,
  l.last_touch_point__c                  AS sf_last_touch_point,
  COALESCE(l.is_converted__c,false)      AS sf_is_converted,
  l.converted_date__c                    AS sf_converted_at,
  l.converted_after_first_touch__c       AS sf_converted_after_first_touch,
  l.customer_before_first_touch__c       AS sf_customer_before_first_touch,
  l.ic_count__c                          AS ic_count,
  l.ic_enrolled_count__c                 AS ic_enrolled_count,
  l.best_ic_status__c                    AS best_ic_status,
  l.ic_course__c                         AS ic_course,
  l.enrollment_count__c                  AS enrollment_count,
  l.enrolled_value__c                    AS sf_enrolled_value,
  l.app_engagement_tier__c               AS app_engagement_tier,
  l.app_time_30d_min__c                  AS app_time_30d_min,
  l.app_active_days_30d__c               AS app_active_days_30d,
  l.app_last_active__c                   AS app_last_active,
  COALESCE(l.is_duplicate__c,false)      AS is_duplicate,
  l.parent_lead_master__c                AS parent_lead_id,
  l.lm_reason__c                         AS lm_reason,
  l.hot_lead__c                          AS hot_lead_date,
  l.supreme_hot__c                       AS supreme_hot_date,
  l.relogged_in__c                       AS relogged_in_date,
  (l.hot_lead__c IS NOT NULL)            AS is_hot,
  (l.supreme_hot__c IS NOT NULL)         AS is_supreme_hot,
  (l.relogged_in__c IS NOT NULL)         AS is_relogged,
  (l.parent_lead_master__c IS NOT NULL)  AS is_repeat,
  analytics.is_paid_lead(l.lead_source__c, l.gclid__c, l.fbclid__c, l.meta_lead_id__c, l.ad_platform__c) AS is_paid_lead,
  (l.gclid__c IS NOT NULL OR l.fbclid__c IS NOT NULL OR l.meta_lead_id__c IS NOT NULL) AS has_click_id,
  -- conversion (from payments)
  (p.lead_id IS NOT NULL)                AS converted,
  p.converted_at,
  p.first_payment_time,
  COALESCE(p.payment_count,0)            AS payment_count,
  COALESCE(p.revenue,0)                  AS revenue,
  COALESCE(p.refunds,0)                  AS refunds,
  p.app_user_id,
  (p.converted_at - analytics.ist_date(l.createddate))::int AS days_to_convert,
  (p.converted_at < analytics.ist_date(l.createddate))      AS pre_existing_customer
FROM salesforce.lead_master__c l
LEFT JOIN salesforce."user" u   ON u.id = l.ownerid
LEFT JOIN analytics.v_lead_payment p ON p.lead_id = l.id
WHERE COALESCE(l.is_deleted__c,false) = false
  AND COALESCE(l.isdeleted,false)     = false;

-- ---------------------------------------------------------------------
-- One row per valid touch (IsDeleted = false, lead exists and not deleted)
-- with sequence numbers and attribution credits.
--
-- is_pre_conversion: touch_date (IST) <= converted_at, or lead not converted.
--   Post-payment touches are kept in the view (for "total touches" and the
--   timeline) but carry NO attribution credit and no touch_seq.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_touch_base AS
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
    (c.converted_at IS NULL OR analytics.ist_date(t.touch_date__c) <= c.converted_at) AS is_pre_conversion
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
      count(*) OVER (PARTITION BY lead_id, is_pre_conversion) END AS n_pre_touches
  FROM tv
  WINDOW w_all AS (PARTITION BY lead_id ORDER BY touch_at, touch_id)
)
SELECT s.*,
  (s.touch_seq = 1)                                         AS is_first_touch,
  (s.touch_seq = s.n_pre_touches)                           AS is_last_touch,
  round((EXTRACT(epoch FROM s.touch_at - s.prev_touch_at) / 3600)::numeric, 2) AS gap_hours_from_prev,
  analytics.gap_bucket((EXTRACT(epoch FROM s.touch_at - s.prev_touch_at) / 3600)::numeric) AS gap_bucket,
  EXTRACT(dow  FROM s.touch_at AT TIME ZONE 'Asia/Kolkata')::int AS touch_dow,
  EXTRACT(hour FROM s.touch_at AT TIME ZONE 'Asia/Kolkata')::int AS touch_hour,
  -- attribution credits (only converted leads, only pre-conversion touches)
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

-- ---------------------------------------------------------------------
-- One row per lead, enriched with touch aggregates
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lead_base AS
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
  (COALESCE(ta.valid_touches,0) > 0)     AS attributable,          -- has >= 1 touch on/before payment
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

-- ---------------------------------------------------------------------
-- Task / call activity, joined to leads on the normalised phone
-- (Task.Mobile_Number__c <-> Lead_Master__c.Mobile_Number__c)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_task_valid AS
SELECT
  t.id                                     AS task_id,
  analytics.phone_key(t.mobile_number__c)  AS phone_key,
  t.whatid,
  t.subject,
  t.type,
  t.status,
  t.activitydate                           AS activity_date,
  t.createddate                            AS task_created_at,
  t.calldurationinseconds                  AS call_seconds,
  t.call_status__c                         AS call_status,
  t.call_start_time__c                     AS call_start_at,
  t.reason__c                              AS reason,
  t.interested_course_status__c            AS ic_status,
  t.ownerid                                AS owner_id,
  (t.call_start_time__c IS NOT NULL OR t.call_status__c IS NOT NULL
     OR t.calldurationinseconds IS NOT NULL OR t.subject ILIKE '%call%') AS is_call,
  (t.call_status__c = 'ANSWERED' OR COALESCE(t.calldurationinseconds,0) > 0) AS is_connected
FROM salesforce.task t
WHERE COALESCE(t.isdeleted,false) = false
  AND analytics.phone_key(t.mobile_number__c) IS NOT NULL;

CREATE OR REPLACE VIEW analytics.v_lead_calls AS
SELECT
  l.lead_id,
  count(*)                                        AS task_count,
  count(*) FILTER (WHERE tv.is_call)              AS call_attempts,
  count(*) FILTER (WHERE tv.is_call AND tv.is_connected) AS calls_connected,
  sum(tv.call_seconds) FILTER (WHERE tv.is_connected)    AS call_seconds_total,
  avg(tv.call_seconds) FILTER (WHERE tv.is_connected AND tv.call_seconds > 0) AS call_seconds_avg,
  min(tv.call_start_at)                           AS first_call_at,
  max(COALESCE(tv.call_start_at, tv.task_created_at)) AS last_task_at,
  (array_agg(tv.reason ORDER BY tv.task_created_at DESC) FILTER (WHERE tv.reason IS NOT NULL))[1] AS last_reason
FROM analytics.v_lead_conv l
JOIN analytics.v_task_valid tv ON tv.phone_key = l.phone_key
GROUP BY l.lead_id;

-- ---------------------------------------------------------------------
-- Interested courses per lead (valid rows)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_ic_base AS
SELECT
  ic.id                     AS ic_id,
  ic.lead_master__c         AS lead_id,
  ic.course__c              AS course_id,
  COALESCE(NULLIF(ic.course_name__c,''), cr.name, ic.course__c) AS course_name,
  COALESCE(NULLIF(btrim(ic.status__c),''),'(blank)') AS status,
  COALESCE(ic.is_enrolled__c,false) AS is_enrolled,
  ic.fees_offered__c        AS fees_offered,
  ic.assigned_date__c       AS assigned_date,
  ic.target_customer__c     AS target_customer,
  ic.ad_campaign__c         AS ad_campaign,
  ic.occupation_categories__c AS occupation,
  ic.createddate            AS ic_created_at,
  ic.ownerid                AS owner_id
FROM salesforce.interested_course__c ic
LEFT JOIN salesforce.course__c cr ON cr.id = ic.course__c
WHERE COALESCE(ic.isdeleted,false) = false
  AND ic.lead_master__c IS NOT NULL;
