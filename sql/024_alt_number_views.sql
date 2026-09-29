-- =====================================================================
-- 024_alt_number_views.sql (2026-09-29)  Lead <-> payment matching through the account's own phone OR its alternative number
-- v_user_phone       : every phone key of a paying app account (its phone, and its alternative number when that is a
--                      different valid Indian mobile)
-- v_valid_payment_x  : the valid payments (payment_method 0), one row per payment and phone key of the paying account;
--                      used ONLY to match payments to leads. v_valid_payment itself stays one row per payment.
-- v_paid_any_x       : same for payments of any method
-- A lead has one phone key and an account's two keys differ, so a payment is never counted twice for one lead.
-- =====================================================================
CREATE OR REPLACE VIEW analytics.v_user_phone AS
SELECT u.id AS user_id, analytics.phone_key(u.phone) AS phone_key, 'phone'::text AS kind
FROM app.home_customuser u
WHERE u.is_deleted = false AND analytics.phone_key(u.phone) IS NOT NULL
UNION ALL
SELECT u.id, analytics.phone_key(u.alternative_number), 'alternative'::text
FROM app.home_customuser u
WHERE u.is_deleted = false AND u.alternative_number IS NOT NULL AND analytics.phone_key_valid(u.alternative_number)
  AND analytics.phone_key(u.alternative_number) IS DISTINCT FROM analytics.phone_key(u.phone);
@@
CREATE OR REPLACE VIEW analytics.v_valid_payment_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id, p.batch_id,
       p.sales_person_id, p.enrollment_id, p.payment_type, up.kind AS matched_by
FROM app.home_payment p
JOIN analytics.v_user_phone up ON up.user_id = p.user_id
WHERE p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_paid_any_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.batch_id, p.enrollment_id, p.payment_type, up.kind AS matched_by
FROM app.home_payment p
JOIN analytics.v_user_phone up ON up.user_id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL;
