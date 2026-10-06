-- =====================================================================
-- 028_ujra.sql (2026-10-06)  Second payment source: the Ujra database (residential Integrated programmes)
-- User decision: a lead is converted when it has a valid payment in the Eduport app database OR in Ujra, and Ujra
-- payments appear in the lead detail, the Converted page and Analysis.
--   app.ujra_student / ujra_booking / ujra_payment   copied by the sync (UJRA_DATABASE_URL), all statuses
--   analytics.v_ujra_payment                         the VALID Ujra payments: status success, not deleted, category booking / course / hostel
--                                                    (asset and dummy are not programme payments)
--   analytics.v_user_phone                           + the Ujra students' numbers (student number, both alternate numbers), keyed by the EPS user id
--   analytics.v_valid_payment / v_paid_any (+ _x)    UNION ALL the Ujra payments; new columns source, course_label, grade_label at the end
--   analytics.v_payment_all                          home_payment-shaped view of both sources for the API (course / grade tables, fee KPIs, Analysis)
-- Ujra payment ids are stored negative (-id) so they never collide with app payment ids; the EPS id of the student is the app user id.
-- =====================================================================
CREATE TABLE IF NOT EXISTS app.ujra_student (
  id                   bigint PRIMARY KEY,
  name                 text,
  number               text,
  whatsapp             text,
  parent_number        text,
  alternate_number     text,
  alternate_number_two text,
  eps_id               text,
  eps_user_id          integer GENERATED ALWAYS AS (NULLIF(regexp_replace(COALESCE(eps_id, ''), '\D', '', 'g'), '')::integer) STORED,
  is_deleted           boolean NOT NULL DEFAULT false,
  created_at           timestamptz,
  updated_at           timestamptz,
  _synced_at           timestamptz NOT NULL DEFAULT now()
);
@@
CREATE TABLE IF NOT EXISTS app.ujra_booking (
  id                        bigint PRIMARY KEY,
  student_id                bigint,
  status                    text,
  course_title              text,
  campus_title              text,
  advance_amount            numeric,
  proposed_course_fee       numeric,
  proposed_registration_fee numeric,
  proposed_material_fee     numeric,
  proposed_hostel_fee       numeric,
  is_deleted                boolean NOT NULL DEFAULT false,
  created_at                timestamptz,
  updated_at                timestamptz,
  _synced_at                timestamptz NOT NULL DEFAULT now()
);
@@
CREATE TABLE IF NOT EXISTS app.ujra_payment (
  id               bigint PRIMARY KEY,
  student_id       bigint,
  booking_id       bigint,
  amount           numeric,
  payment_date     timestamptz,
  payment_status   text,
  payment_category text,
  payment_mode     text,
  payment_success  boolean,
  refund_amount    numeric,
  academic_year_id bigint,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz,
  updated_at       timestamptz,
  _synced_at       timestamptz NOT NULL DEFAULT now()
);
@@
CREATE INDEX IF NOT EXISTS ujra_payment_student ON app.ujra_payment (student_id);
CREATE INDEX IF NOT EXISTS ujra_payment_date ON app.ujra_payment (payment_date);
CREATE INDEX IF NOT EXISTS ujra_booking_student ON app.ujra_booking (student_id);
CREATE INDEX IF NOT EXISTS ujra_student_eps ON app.ujra_student (eps_user_id);
CREATE INDEX IF NOT EXISTS ujra_student_phone ON app.ujra_student (analytics.phone_key(number));
@@
-- the programme a student is in: the booking the payment belongs to, else the student's latest booking (confirmed first)
CREATE OR REPLACE VIEW analytics.v_ujra_course AS
SELECT DISTINCT ON (b.student_id) b.student_id, b.id AS booking_id, b.course_title, b.campus_title, b.status,
       (COALESCE(b.proposed_course_fee, 0) + COALESCE(b.proposed_registration_fee, 0) + COALESCE(b.proposed_material_fee, 0)) AS proposed_fee
FROM app.ujra_booking b
WHERE NOT b.is_deleted
ORDER BY b.student_id, (b.status = 'confirmed') DESC, b.created_at DESC;
@@
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
WHERE NOT p.is_deleted AND p.payment_status = 'success' AND COALESCE(p.payment_success, true)
  AND p.payment_category IN ('booking', 'course', 'hostel') AND p.payment_date IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_user_phone AS
SELECT x.user_id, x.phone_key, min(x.kind) AS kind
FROM (
  SELECT u.id AS user_id, analytics.phone_key(u.phone) AS phone_key, 'phone'::text AS kind
  FROM app.home_customuser u WHERE u.is_deleted = false AND analytics.phone_key(u.phone) IS NOT NULL
  UNION ALL
  SELECT u.id, analytics.phone_key(u.alternative_number), 'alternative'::text
  FROM app.home_customuser u
  WHERE u.is_deleted = false AND u.alternative_number IS NOT NULL AND analytics.phone_key_valid(u.alternative_number)
    AND analytics.phone_key(u.alternative_number) IS DISTINCT FROM analytics.phone_key(u.phone)
  UNION ALL
  SELECT s.eps_user_id, analytics.phone_key(s.number), 'ujra'::text
  FROM app.ujra_student s WHERE NOT s.is_deleted AND s.eps_user_id IS NOT NULL AND analytics.phone_key_valid(s.number)
  UNION ALL
  SELECT s.eps_user_id, analytics.phone_key(s.alternate_number), 'ujra alternate'::text
  FROM app.ujra_student s WHERE NOT s.is_deleted AND s.eps_user_id IS NOT NULL AND analytics.phone_key_valid(s.alternate_number)
  UNION ALL
  SELECT s.eps_user_id, analytics.phone_key(s.alternate_number_two), 'ujra alternate'::text
  FROM app.ujra_student s WHERE NOT s.is_deleted AND s.eps_user_id IS NOT NULL AND analytics.phone_key_valid(s.alternate_number_two)
) x
GROUP BY x.user_id, x.phone_key;
@@
CREATE OR REPLACE VIEW analytics.v_valid_payment AS
SELECT p.id AS payment_id, p.user_id, analytics.phone_key(u.phone) AS phone_key, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id,
       COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id,
       p.sales_person_id, p.enrollment_id, p.payment_type,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true AND u.is_deleted = false AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.phone_key, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2) AS total, q.amount::numeric(18,2), NULL::numeric(18,2), NULL::numeric(18,2), q.refund_amount::numeric(18,2), NULL::integer, NULL::bigint,
       NULL::bigint, NULL::integer, (-q.booking_id)::integer, NULL::integer,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.v_ujra_payment q WHERE q.phone_key IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_paid_any AS
SELECT p.id AS payment_id, p.user_id, analytics.phone_key(u.phone) AS phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND u.is_deleted = false AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.phone_key, 0, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.v_ujra_payment q WHERE q.phone_key IS NOT NULL;
@@
CREATE OR REPLACE VIEW analytics.v_valid_payment_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id,
       p.sales_person_id, p.enrollment_id, p.payment_type, up.kind AS matched_by,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN analytics.v_user_phone up ON up.user_id = p.user_id
WHERE p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, k.phone_key, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::numeric(18,2), NULL::numeric(18,2), q.refund_amount::numeric(18,2), NULL::integer, NULL::bigint, NULL::bigint,
       NULL::integer, (-q.booking_id)::integer, NULL::integer, k.kind,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.v_ujra_payment q
CROSS JOIN LATERAL (SELECT DISTINCT ON (pk) pk AS phone_key, kind FROM (VALUES (q.phone_key, 'ujra'), (q.alt_key1, 'ujra alternate'), (q.alt_key2, 'ujra alternate')) AS v(pk, kind) WHERE pk IS NOT NULL ORDER BY pk, kind) k;
@@
CREATE OR REPLACE VIEW analytics.v_paid_any_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type, up.kind AS matched_by,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN analytics.v_user_phone up ON up.user_id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, k.phone_key, 0, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, k.kind,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.v_ujra_payment q
CROSS JOIN LATERAL (SELECT DISTINCT ON (pk) pk AS phone_key, kind FROM (VALUES (q.phone_key, 'ujra'), (q.alt_key1, 'ujra alternate'), (q.alt_key2, 'ujra alternate')) AS v(pk, kind) WHERE pk IS NOT NULL ORDER BY pk, kind) k;
@@
-- home_payment-shaped view of BOTH sources for the API queries (course / grade tables, fee KPIs, Analysis)
CREATE OR REPLACE VIEW analytics.v_payment_all AS
SELECT hp.id, hp.user_id, hp.payment_method, hp.deleted, hp.is_success, hp.payment_success, hp.payment_date, hp.payment_time, hp.created,
       hp.amount, hp.total, hp.batch_id, hp.enrollment_batch_id, hp.enrollment_id, hp.enrollment_fee, hp.enrollment_discount,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment hp
UNION ALL
SELECT q.payment_id, q.user_id, 0, false, true, true, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, NULL::bigint, (-q.booking_id)::integer, q.proposed_fee, 0::numeric,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.v_ujra_payment q;
@@
SELECT count(*) AS ujra_payments_valid FROM analytics.v_ujra_payment;
