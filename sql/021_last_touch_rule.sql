-- =====================================================================
-- 021_last_touch_rule.sql (2026-09-26)  Last-touch credit: the Eduport App rule
-- If the last touch before a payment is an Eduport App touch made LESS THAN 2 HOURS before the payment moment,
-- the credit goes to the previous touch before the payment; if that app touch is the only touch, it keeps the credit.
-- Applied to (1) analytics.v_touch_base.tab_last_valid_at -> mv_touch_flat.tab_is_last_touch (Last touch page, lead lists)
-- and (2) analytics.mv_payer last_touch_* (Converted page). mv_payer is swapped in by rename (no downtime), then mv_touch_flat is refreshed.
-- =====================================================================
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
    c.district, c.city, c.owner_id, c.owner_name, c.best_ic_status, c.is_duplicate, c.is_paid_lead,
    c.converted, c.converted_at, c.revenue, c.pre_existing_customer,
    (c.converted_at IS NULL OR analytics.ist_date(t.touch_date__c) <= c.converted_at) AS is_pre_conversion,
    c.last_payment_date,
    c.app_user_id,
    -- Tableau workbook 'Converted': ANY valid payment dated on/after the touch day
    COALESCE(c.last_payment_date >= analytics.ist_date(t.touch_date__c), false) AS tab_converted,
    c.courses,
    c.last_payment_at,
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
    -- last valid touch = latest touch made BEFORE the moment of the lead's last valid payment (same-day touches count when they precede the payment).
    -- Eduport App rule (2026-09-26): an app touch made less than 2 hours before the payment does not take the credit;
    -- the previous touch before the payment does. If no other touch exists before the payment, the app touch keeps it.
    COALESCE(
      max(touch_at) FILTER (WHERE last_payment_at IS NOT NULL AND touch_at <= last_payment_at
                              AND NOT (touch_point = 'Eduport App' AND touch_at > last_payment_at - interval '2 hours')) OVER (PARTITION BY lead_id),
      max(touch_at) FILTER (WHERE last_payment_at IS NOT NULL AND touch_at <= last_payment_at) OVER (PARTITION BY lead_id)
    ) AS tab_last_valid_at
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

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_payer_new;
CREATE MATERIALIZED VIEW analytics.mv_payer_new AS
WITH pay AS (
  SELECT vp.user_id, vp.phone_key,
         min(vp.payment_date) AS first_payment_date, max(vp.payment_date) AS last_payment_date,
         max(CASE WHEN vp.payment_time IS NOT NULL THEN vp.payment_time
                  WHEN (vp.payment_created AT TIME ZONE 'Asia/Kolkata')::date = vp.payment_date THEN vp.payment_created
                  ELSE ((vp.payment_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') END) AS last_payment_at,
         count(*)::int AS payments, sum(vp.amount) AS revenue,
         count(*) FILTER (WHERE vp.payment_method = 0)::int AS payments_m0,
         count(*) FILTER (WHERE vp.payment_method <> 0)::int AS payments_m1,
         min(vp.payment_date) FILTER (WHERE vp.payment_method = 0) AS first_payment_date_m0,
         string_agg(DISTINCT COALESCE(b.title, 'batch ' || vp.batch_id::text), ' | ') AS courses,
         string_agg(DISTINCT COALESCE(b.grade_title, 'No Grade On Batch'), ' | ') AS grades
  FROM analytics.v_paid_any vp LEFT JOIN app.core_batch b ON b.id = vp.batch_id
  GROUP BY 1, 2),
leads AS (
  SELECT c.lead_id, c.phone_key, c.lead_name, c.lead_stage, c.class_raw, c.class_group, c.lead_source, c.owner_name, c.created_at
  FROM analytics.v_lead_conv c WHERE c.phone_key IS NOT NULL),
ul AS (SELECT p.user_id, l.* FROM pay p JOIN leads l USING (phone_key)),
lead1 AS (SELECT DISTINCT ON (user_id) * FROM ul ORDER BY user_id, created_at DESC),
touches AS (
  SELECT ul.user_id, t.touch_id, t.touch_at, t.touch_date, t.touch_point, t.source, t.medium, t.campaign, t.staff, t.lead_id
  FROM ul JOIN analytics.mv_touch_flat t ON t.lead_id = ul.lead_id),
lt AS (
  -- latest touch on/before the last payment day; an Eduport App touch less than 2 hours before the payment moment is skipped
  -- in favour of the touch before it (rank 0), unless it is the only touch (rank 1 fallback)
  SELECT DISTINCT ON (x.user_id) x.*
  FROM (
    SELECT x.*, CASE WHEN x.touch_point = 'Eduport App' AND x.touch_at > p.last_payment_at - interval '2 hours' THEN 1 ELSE 0 END AS rank_app
    FROM touches x JOIN pay p USING (user_id)
    WHERE x.touch_date <= p.last_payment_date
  ) x
  ORDER BY x.user_id, x.rank_app, x.touch_at DESC, x.touch_id DESC),
ntb AS (
  SELECT x.user_id, count(*) FILTER (WHERE x.touch_date <= p.last_payment_date)::int AS touches_on_before
  FROM touches x JOIN pay p USING (user_id) GROUP BY 1)
SELECT p.user_id, p.phone_key, p.first_payment_date, p.last_payment_date, p.last_payment_at, p.payments, p.revenue, p.courses, p.grades,
       p.payments_m0, p.payments_m1, p.first_payment_date_m0,
       lead1.lead_id, lead1.lead_name, lead1.lead_stage, lead1.class_raw, lead1.class_group, lead1.lead_source, lead1.owner_name,
       (lead1.lead_id IS NULL) AS no_lead,
       lt.touch_at AS last_touch_at, lt.touch_id AS last_touch_id,
       COALESCE(lt.touch_point, 'No Touch Before Payment') AS last_touch_point,
       COALESCE(lt.source,      'No Touch Before Payment') AS last_touch_source,
       COALESCE(lt.medium,      'No Touch Before Payment') AS last_touch_medium,
       COALESCE(lt.campaign,    'No Touch Before Payment') AS last_touch_campaign,
       COALESCE(lt.staff,       CASE WHEN lt.touch_id IS NULL THEN 'No Touch Before Payment' ELSE '(Blank)' END) AS last_touch_staff,
       COALESCE(ntb.touches_on_before, 0) AS touches_before_payment
FROM pay p
LEFT JOIN lead1 USING (user_id)
LEFT JOIN lt    USING (user_id)
LEFT JOIN ntb   USING (user_id);
CREATE UNIQUE INDEX mv_payer_new_pk ON analytics.mv_payer_new (user_id);
CREATE INDEX mv_payer_new_last_pay ON analytics.mv_payer_new (last_payment_date);

BEGIN;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_payer;
ALTER MATERIALIZED VIEW analytics.mv_payer_new RENAME TO mv_payer;
ALTER INDEX analytics.mv_payer_new_pk RENAME TO mv_payer_pk;
ALTER INDEX analytics.mv_payer_new_last_pay RENAME TO mv_payer_last_pay;
COMMIT;

SELECT analytics.refresh_one('analytics.mv_touch_flat'::regclass) AS touch_rows;

-- check: payers (method 0) with a payment 1-23 Sep by credited last touch point
SELECT m.last_touch_point, count(*) AS users
FROM analytics.mv_payer m
WHERE EXISTS (SELECT 1 FROM app.home_payment hp WHERE hp.user_id = m.user_id AND hp.payment_method = 0 AND hp.deleted = false AND hp.is_success AND hp.payment_success AND hp.payment_date BETWEEN '2026-09-01' AND '2026-09-23')
GROUP BY 1 ORDER BY 2 DESC LIMIT 8;
