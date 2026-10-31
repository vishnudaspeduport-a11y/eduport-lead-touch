-- 047 (2026-10-31): the payment method of an Ujra payment follows its category, with the meaning the app's payment_method has.
-- User rule: in the app, payment_method 0 is the first payment of a course (the sale) and 1 an instalment; in Ujra the first payment of a
-- course is the one with payment_category = 'booking' (4,098 of 4,127 paying students start with a booking), course and hostel payments
-- are the instalments. Until now every Ujra payment was reported as method 0, so "Method 0" on the Converted page and the Fee KPIs
-- (payment_method = 0) counted every Ujra instalment as a first payment. Now: booking -> 0, course / hostel -> 1, in the three views that
-- carry a payment method (v_paid_any feeds mv_payer: payments_m0 / payments_m1 / first_payment_date_m0; v_paid_any_x; v_payment_all).
-- v_valid_payment_x (the conversion rule: any valid payment, booking or not) is unchanged. Column lists are unchanged.
-- After running: refresh mv_payer (workflow_dispatch objects=refresh_only) so first_payment_date_m0 follows the new rule.

CREATE OR REPLACE VIEW analytics.v_paid_any AS
SELECT p.id AS payment_id, p.user_id, analytics.phone_key(u.phone) AS phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND u.is_deleted = false AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.phone_key, (CASE WHEN q.payment_category = 'booking' THEN 0 ELSE 1 END), q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.phone_key IS NOT NULL;

CREATE OR REPLACE VIEW analytics.v_paid_any_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type, up.kind AS matched_by,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN analytics.mv_user_phone up ON up.user_id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.phone_key, (CASE WHEN q.payment_category = 'booking' THEN 0 ELSE 1 END), q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, 'ujra'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.phone_key IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.alt_key1, (CASE WHEN q.payment_category = 'booking' THEN 0 ELSE 1 END), q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, 'ujra alternate'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.alt_key1 IS NOT NULL AND q.alt_key1 IS DISTINCT FROM q.phone_key
UNION ALL
SELECT q.payment_id, q.user_id, q.alt_key2, (CASE WHEN q.payment_category = 'booking' THEN 0 ELSE 1 END), q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, 'ujra alternate'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.alt_key2 IS NOT NULL AND q.alt_key2 IS DISTINCT FROM q.phone_key AND q.alt_key2 IS DISTINCT FROM q.alt_key1;

CREATE OR REPLACE VIEW analytics.v_payment_all AS
SELECT hp.id, hp.user_id, hp.payment_method, hp.deleted, hp.is_success, hp.payment_success, hp.payment_date, hp.payment_time, hp.created,
       hp.amount, hp.total, hp.batch_id, hp.enrollment_batch_id, hp.enrollment_id, hp.enrollment_fee, hp.enrollment_discount,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment hp
UNION ALL
SELECT q.payment_id, q.user_id, (CASE WHEN q.payment_category = 'booking' THEN 0 ELSE 1 END), false, true, true, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, NULL::bigint, (-q.booking_id)::integer, q.proposed_fee, 0::numeric,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q;

SELECT source, payment_method, count(*) AS payments, count(DISTINCT user_id) AS users
FROM analytics.v_payment_all WHERE deleted = false AND is_success = true AND payment_success = true AND payment_date BETWEEN '2026-10-01' AND '2026-10-31'
GROUP BY 1, 2 ORDER BY 1, 2;
