-- =====================================================================
-- 025_alt_number_switch.sql (2026-09-29)  The conversion rule now matches a payment to a lead through the paying
-- account's own phone OR its alternative number (user decision; the mother / father numbers are not used).
--   1. analytics.v_lead_payment joins analytics.v_valid_payment_x  -> v_lead_conv -> mv_touch_flat (Overview, First / Last touch, Turnaround)
--   2. analytics.mv_payer: a paying user is linked to the leads on any of its phone keys (Converted page), swapped in by rename
--   3. refresh of mv_touch_flat
-- =====================================================================
CREATE OR REPLACE VIEW analytics.v_lead_payment AS
SELECT l.id AS lead_id,
       min(vp.payment_date) AS converted_at,
       min(vp.payment_time) AS first_payment_time,
       count(*)             AS payment_count,
       sum(vp.amount)       AS revenue,   -- amount, not total: gateway-2 payment-link rows carry the money in amount/fee and leave total = 0
       sum(COALESCE(vp.refund_amount, 0)) AS refunds,
       min(vp.user_id)      AS app_user_id,
       max(vp.payment_date) AS last_payment_date,
       max(vp.payment_date) FILTER (WHERE vp.amount > 0) AS last_paid_payment_date,   -- kept for compatibility (view columns cannot be dropped in place); unused
       string_agg(DISTINCT COALESCE(b.title, 'batch ' || vp.batch_id::text), ' | ') AS courses,
       -- moment of the last valid payment: payment_time if recorded, else the record's creation time when it is on the payment day,
       -- else the end of the payment day (IST) so that any touch on that day counts as "before the payment"
       max(CASE WHEN vp.payment_time IS NOT NULL THEN vp.payment_time
                WHEN (vp.payment_created AT TIME ZONE 'Asia/Kolkata')::date = vp.payment_date THEN vp.payment_created
                ELSE ((vp.payment_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') END) AS last_payment_at
FROM salesforce.lead_master__c l
-- 025: the paying account's own phone OR its alternative number (v_valid_payment_x has one row per payment and phone key)
JOIN analytics.v_valid_payment_x vp ON vp.phone_key = analytics.phone_key(l.mobile_number__c)
LEFT JOIN app.core_batch b ON b.id = vp.batch_id
GROUP BY l.id;
@@
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
ul AS (
  -- 025: leads on the account's own phone or on its alternative number
  SELECT DISTINCT p.user_id, l.*
  FROM pay p JOIN analytics.v_user_phone up ON up.user_id = p.user_id JOIN leads l ON l.phone_key = up.phone_key),
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
CREATE INDEX mv_payer_new_phone ON analytics.mv_payer_new (phone_key);

BEGIN;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_payer;
ALTER MATERIALIZED VIEW analytics.mv_payer_new RENAME TO mv_payer;
ALTER INDEX analytics.mv_payer_new_pk RENAME TO mv_payer_pk;
ALTER INDEX analytics.mv_payer_new_last_pay RENAME TO mv_payer_last_pay;
ALTER INDEX analytics.mv_payer_new_phone RENAME TO mv_payer_phone;
COMMIT;
@@
SELECT analytics.refresh_one('analytics.mv_touch_flat'::regclass) AS touch_rows;
@@
SELECT count(*) AS payers, count(*) FILTER (WHERE NOT no_lead) AS with_lead FROM analytics.mv_payer;
