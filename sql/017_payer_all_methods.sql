-- =====================================================================
-- 017_payer_all_methods.sql (2026-09-25)  Converted page: every payment method
-- The Tableau workbook (and the Overview's "Converted") only count payment_method = 0. Metabase's sales
-- counts include payment_method = 1 as well (gateway EMI instalments: every such row carries an emi_id).
-- The Converted page gets a "Payment method" switch, so mv_payer must know every paying user.
--   v_paid_any : valid payments of ANY method (+ payment_method column)     -- v_valid_payment stays method 0 for the Overview
--   mv_payer   : rebuilt from v_paid_any, with payments_m0 / payments_m1 per user; swapped in by rename (no downtime)
-- Run AFTER the app.home_payment backfill (sync full reload of home_payment + home_customuser).
-- =====================================================================
CREATE OR REPLACE VIEW analytics.v_paid_any AS
SELECT
  p.id                              AS payment_id,
  p.user_id,
  analytics.phone_key(u.phone)      AS phone_key,
  p.payment_method,
  p.payment_date,
  p.payment_time,
  p.created                         AS payment_created,
  p.total,
  p.amount,
  p.batch_id,
  p.enrollment_id,
  p.payment_type
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.deleted         = false
  AND p.is_success      = true
  AND p.payment_success = true
  AND u.is_deleted      = false
  AND p.payment_date IS NOT NULL;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_payer_new;
CREATE MATERIALIZED VIEW analytics.mv_payer_new AS
WITH pay AS (
  SELECT vp.user_id, vp.phone_key,
         min(vp.payment_date) AS first_payment_date, max(vp.payment_date) AS last_payment_date,
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
  SELECT DISTINCT ON (x.user_id) x.*
  FROM touches x JOIN pay p USING (user_id)
  WHERE x.touch_date <= p.last_payment_date
  ORDER BY x.user_id, x.touch_at DESC, x.touch_id DESC),
ntb AS (
  SELECT x.user_id, count(*) FILTER (WHERE x.touch_date <= p.last_payment_date)::int AS touches_on_before
  FROM touches x JOIN pay p USING (user_id) GROUP BY 1)
SELECT p.user_id, p.phone_key, p.first_payment_date, p.last_payment_date, p.payments, p.revenue, p.courses, p.grades,
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

SELECT count(*) AS payers, count(*) FILTER (WHERE payments_m0 = 0) AS method1_only_payers,
       count(*) FILTER (WHERE last_payment_date BETWEEN '2026-09-01' AND '2026-09-23') AS in_sep_window
FROM analytics.mv_payer;
