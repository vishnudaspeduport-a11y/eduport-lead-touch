-- 032 (2026-10-12): index-friendly payment lookups per phone / per user.
-- EXPLAIN showed that one "payments of this phone number" lookup through v_valid_payment_x cost ~200 ms, 190 ms of it in the
-- Ujra branch: a LATERAL VALUES over the student's three numbers cannot use an index, so every lookup scanned all Ujra
-- payments. The lead explorer and the drill-down lists do that lookup once per row (50-200 rows = 10-40 s).
-- Likewise v_user_phone (a GROUP BY over a 5-way UNION) is estimated at 200 rows per phone, which pushed the planner into
-- hash joins with sequential scans of home_payment inside per-row LATERALs.
-- Fix: materialize the two small sets (Ujra payments ~22k rows, user<->phone keys ~800k rows) with proper indexes, and
-- rewrite the Ujra branch as three UNION ALL branches keyed on an indexed column each. Both are refreshed by refresh_all()
-- ahead of mv_touch_flat / mv_payer. Column lists of the replaced views are unchanged.

-- ---------------------------------------------------------------- materialized sources
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_ujra_payment AS SELECT * FROM analytics.v_ujra_payment WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_ujra_payment_pk    ON analytics.mv_ujra_payment (payment_id);
CREATE INDEX IF NOT EXISTS mv_ujra_payment_user         ON analytics.mv_ujra_payment (user_id);
CREATE INDEX IF NOT EXISTS mv_ujra_payment_phone        ON analytics.mv_ujra_payment (phone_key);
CREATE INDEX IF NOT EXISTS mv_ujra_payment_alt1         ON analytics.mv_ujra_payment (alt_key1);
CREATE INDEX IF NOT EXISTS mv_ujra_payment_alt2         ON analytics.mv_ujra_payment (alt_key2);
CREATE INDEX IF NOT EXISTS mv_ujra_payment_date         ON analytics.mv_ujra_payment (payment_date);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_user_phone AS SELECT * FROM analytics.v_user_phone WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_user_phone_pk      ON analytics.mv_user_phone (user_id, phone_key);
CREATE INDEX IF NOT EXISTS mv_user_phone_phone          ON analytics.mv_user_phone (phone_key);


-- ---------------------------------------------------------------- views on the materialized sources
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
FROM analytics.mv_ujra_payment q WHERE q.phone_key IS NOT NULL;

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
FROM analytics.mv_ujra_payment q WHERE q.phone_key IS NOT NULL;

-- per phone key: app payments through every number of the account; Ujra payments through the student's three numbers,
-- each branch filtered on its own indexed column (a number repeated across the three fields is reported once, phone first)
CREATE OR REPLACE VIEW analytics.v_valid_payment_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, p.tuition_fees, p.discount, p.refund_amount, p.course_id, p.course_new_id, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id,
       p.sales_person_id, p.enrollment_id, p.payment_type, up.kind AS matched_by,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN analytics.mv_user_phone up ON up.user_id = p.user_id
WHERE p.payment_method = 0 AND p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.phone_key, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::numeric(18,2), NULL::numeric(18,2), q.refund_amount::numeric(18,2), NULL::integer, NULL::bigint, NULL::bigint,
       NULL::integer, (-q.booking_id)::integer, NULL::integer, 'ujra'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.phone_key IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.alt_key1, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::numeric(18,2), NULL::numeric(18,2), q.refund_amount::numeric(18,2), NULL::integer, NULL::bigint, NULL::bigint,
       NULL::integer, (-q.booking_id)::integer, NULL::integer, 'ujra alternate'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.alt_key1 IS NOT NULL AND q.alt_key1 IS DISTINCT FROM q.phone_key
UNION ALL
SELECT q.payment_id, q.user_id, q.alt_key2, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::numeric(18,2), NULL::numeric(18,2), q.refund_amount::numeric(18,2), NULL::integer, NULL::bigint, NULL::bigint,
       NULL::integer, (-q.booking_id)::integer, NULL::integer, 'ujra alternate'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.alt_key2 IS NOT NULL AND q.alt_key2 IS DISTINCT FROM q.phone_key AND q.alt_key2 IS DISTINCT FROM q.alt_key1;

CREATE OR REPLACE VIEW analytics.v_paid_any_x AS
SELECT p.id AS payment_id, p.user_id, up.phone_key, p.payment_method, p.payment_date, p.payment_time, p.created AS payment_created,
       p.total, p.amount, COALESCE(p.enrollment_batch_id, p.batch_id) AS batch_id, p.enrollment_id, p.payment_type, up.kind AS matched_by,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment p
JOIN analytics.mv_user_phone up ON up.user_id = p.user_id
WHERE p.deleted = false AND p.is_success = true AND p.payment_success = true AND p.payment_date IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.phone_key, 0, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, 'ujra'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.phone_key IS NOT NULL
UNION ALL
SELECT q.payment_id, q.user_id, q.alt_key1, 0, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, 'ujra alternate'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.alt_key1 IS NOT NULL AND q.alt_key1 IS DISTINCT FROM q.phone_key
UNION ALL
SELECT q.payment_id, q.user_id, q.alt_key2, 0, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, (-q.booking_id)::integer, NULL::integer, 'ujra alternate'::text,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q WHERE q.alt_key2 IS NOT NULL AND q.alt_key2 IS DISTINCT FROM q.phone_key AND q.alt_key2 IS DISTINCT FROM q.alt_key1;

CREATE OR REPLACE VIEW analytics.v_payment_all AS
SELECT hp.id, hp.user_id, hp.payment_method, hp.deleted, hp.is_success, hp.payment_success, hp.payment_date, hp.payment_time, hp.created,
       hp.amount, hp.total, hp.batch_id, hp.enrollment_batch_id, hp.enrollment_id, hp.enrollment_fee, hp.enrollment_discount,
       'app'::text AS source, NULL::text AS course_label, NULL::text AS grade_label
FROM app.home_payment hp
UNION ALL
SELECT q.payment_id, q.user_id, 0, false, true, true, q.payment_date, q.payment_time, q.payment_created,
       q.amount::numeric(18,2), q.amount::numeric(18,2), NULL::bigint, NULL::bigint, (-q.booking_id)::integer, q.proposed_fee, 0::numeric,
       'ujra'::text, q.course_label, 'Integrated'::text
FROM analytics.mv_ujra_payment q;

-- ---------------------------------------------------------------- refresh order: sources first, then the big ones
CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE t0 timestamptz; n bigint; v text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN RAISE NOTICE 'refresh_all already running'; RETURN; END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY['analytics.mv_user_phone', 'analytics.mv_ujra_payment', 'analytics.mv_touch_flat', 'analytics.mv_payer'] LOOP
      t0 := clock_timestamp();
      n := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n; seconds := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all')); RAISE; END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;

ANALYZE analytics.mv_ujra_payment;
ANALYZE analytics.mv_user_phone;

SELECT (SELECT count(*) FROM analytics.mv_user_phone) AS user_phone_rows, (SELECT count(*) FROM analytics.mv_ujra_payment) AS ujra_rows,
       (SELECT count(*) FROM analytics.v_valid_payment_x) AS valid_x_rows, (SELECT count(DISTINCT phone_key) FROM analytics.v_valid_payment_x WHERE source = 'ujra') AS ujra_keys;
