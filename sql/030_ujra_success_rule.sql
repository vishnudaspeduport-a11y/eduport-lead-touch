-- 030 (2026-10-06): Ujra's payment_success flag is not set on many successful payments (6,323 of 24,085 success rows have it false),
-- and the Metabase sales query ignores it. A valid Ujra payment = status success, not deleted, category booking / course / hostel.
CREATE OR REPLACE VIEW analytics.v_ujra_payment AS
SELECT (-p.id)::integer AS payment_id, s.eps_user_id AS user_id, p.student_id,
       analytics.phone_key(s.number) AS phone_key, analytics.phone_key(s.alternate_number) AS alt_key1, analytics.phone_key(s.alternate_number_two) AS alt_key2,
       analytics.ist_date(p.payment_date) AS payment_date, p.payment_date AS payment_time, p.created_at AS payment_created,
       p.amount, COALESCE(p.refund_amount, 0) AS refund_amount, p.payment_category, p.payment_mode,
       COALESCE(b.id, c.booking_id) AS booking_id,
       COALESCE(b.course_title, c.course_title, 'Integrated programme') AS course_label,
       COALESCE(b.campus_title, c.campus_title) AS campus_title,
       COALESCE(COALESCE(b.proposed_course_fee, 0) + COALESCE(b.proposed_registration_fee, 0) + COALESCE(b.proposed_material_fee, 0), c.proposed_fee) AS proposed_fee
FROM app.ujra_payment p
JOIN app.ujra_student s ON s.id = p.student_id AND NOT s.is_deleted
LEFT JOIN app.ujra_booking b ON b.id = p.booking_id AND NOT b.is_deleted
LEFT JOIN analytics.v_ujra_course c ON c.student_id = p.student_id
WHERE NOT p.is_deleted AND p.payment_status = 'success'
  AND p.payment_category IN ('booking', 'course', 'hostel') AND p.payment_date IS NOT NULL;
@@
SELECT (SELECT count(*) FROM analytics.v_ujra_payment) AS valid, (SELECT count(DISTINCT user_id) FROM analytics.v_ujra_payment) AS students, (SELECT count(*) FROM analytics.v_valid_payment_x WHERE phone_key = '9947222791') AS example_payments;
@@
SELECT * FROM analytics.refresh_all();
@@
SELECT count(*) AS payers, count(*) FILTER (WHERE has_ujra) AS ujra_payers, count(*) FILTER (WHERE has_ujra AND NOT has_app) AS ujra_only, count(*) FILTER (WHERE has_ujra AND NOT no_lead) AS ujra_with_lead FROM analytics.mv_payer;
