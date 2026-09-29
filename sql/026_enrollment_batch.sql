-- =====================================================================
-- 026_enrollment_batch.sql (2026-09-29)  Course and grade of a purchase follow the ENROLLMENT's batch (user decision,
-- same rule as the Metabase sales query): home_payment.enrollment_id -> home_enrollment.batch_id -> core_batch.
-- The batch recorded on the payment itself is only the fallback when the enrollment has none.
--   app.home_payment.enrollment_batch_id  copied by the sync (he.batch_id)
--   analytics.course_label()              course name with the Fastrack / Booster naming of the Metabase query
--   v_valid_payment / v_paid_any (+ _x)   batch_id = COALESCE(enrollment batch, payment batch)
-- =====================================================================
ALTER TABLE app.home_payment ADD COLUMN IF NOT EXISTS enrollment_batch_id bigint;
@@
CREATE OR REPLACE FUNCTION analytics.course_label(batch_title text, course_title text, batch_id bigint)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT btrim(CASE
    WHEN course_title IS NULL THEN COALESCE('batch ' || batch_id::text, 'No batch')
    WHEN batch_title ILIKE '%fastrack%' THEN CASE
      WHEN course_title ILIKE '%fastrack%' THEN course_title
      WHEN course_title ILIKE '%booster%'  THEN replace(course_title, 'booster', 'fastrack')
      ELSE btrim(course_title) || ' - Fastrack' END
    WHEN batch_title ILIKE '%booster%' THEN CASE
      WHEN course_title ILIKE '%booster%'  THEN course_title
      WHEN course_title ILIKE '%fastrack%' THEN replace(course_title, 'fastrack', 'booster')
      ELSE btrim(course_title) || ' - Booster' END
    ELSE regexp_replace(course_title, '\s*[-–—]?\s*(fastrack|booster)\s*$', '', 'i')
  END)
$fn$;
@@
CREATE OR REPLACE VIEW analytics.v_valid_payment AS
SELECT p.id AS payment_id, p.user_id, analytics.phone_key(u.phone) AS phone_key, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id,
       COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id,
       p.sales_person_id, p.enrollment_id, p.payment_type
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true AND u.is_deleted = false AND p.payment_date IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_paid_any AS
SELECT p.id AS payment_id, p.user_id, analytics.phone_key(u.phone) AS phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND u.is_deleted = false AND p.payment_date IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_valid_payment_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id,
       p.sales_person_id, p.enrollment_id, p.payment_type, up.kind AS matched_by
FROM app.home_payment p
JOIN analytics.v_user_phone up ON up.user_id = p.user_id
WHERE p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_paid_any_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type, up.kind AS matched_by
FROM app.home_payment p
JOIN analytics.v_user_phone up ON up.user_id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL;
@@
SELECT analytics.course_label('Fastrack_SSLC English Medium (2026-27) Single Year - B6', 'SSLC English Medium (2026-27) ', 4556) AS fastrack, analytics.course_label('SSLC English Medium (2026-27)-Single Year-B1', 'SSLC English Medium (2026-27) ', 1) AS plain, analytics.course_label('Booster-Class 8 Malayalam Medium(2025-26) Single Year-B2', 'Class 8 Malayalam Medium (2025-26)', 2) AS booster, analytics.course_label(NULL, NULL, 77) AS no_course;
