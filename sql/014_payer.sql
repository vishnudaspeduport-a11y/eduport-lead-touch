-- =====================================================================
-- 014_payer.sql (2026-09-23)  Paying-user grain for the "Converted" page
-- Mirrors the Tableau workbook "Converted" / dashboard "Lead Touch - Converted":
--   grain  = paying app user (home_payment.user_id) with a valid payment; the page filters on PAYMENT date
--   credit = the user's last touch on/before its last valid payment date (DATE level, same day included),
--            across every Salesforce lead sharing the user's phone; "No Touch Before Payment" otherwise
--   class  = grade of the purchased course (core_batch -> core_syllabusstructure -> core_grade), kept per payment
-- One row per paying user. Depends on mv_touch_flat (refresh order: touch_flat, then payer).
-- =====================================================================
ALTER TABLE app.core_batch ADD COLUMN IF NOT EXISTS grade_title text;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_payer;
CREATE MATERIALIZED VIEW analytics.mv_payer AS
WITH pay AS (
  SELECT vp.user_id, vp.phone_key,
         min(vp.payment_date) AS first_payment_date, max(vp.payment_date) AS last_payment_date,
         count(*)::int AS payments, sum(vp.amount) AS revenue,
         string_agg(DISTINCT COALESCE(b.title, 'batch ' || vp.batch_id::text), ' | ') AS courses,
         string_agg(DISTINCT COALESCE(b.grade_title, 'No Grade On Batch'), ' | ') AS grades
  FROM analytics.v_valid_payment vp LEFT JOIN app.core_batch b ON b.id = vp.batch_id
  GROUP BY 1, 2),
leads AS (
  SELECT c.lead_id, c.phone_key, c.lead_name, c.lead_stage, c.class_raw, c.class_group, c.lead_source, c.owner_name, c.created_at, c.lm_reason, c.district
  FROM analytics.v_lead_conv c WHERE c.phone_key IS NOT NULL),
ul AS (SELECT p.user_id, l.* FROM pay p JOIN leads l USING (phone_key)),
lead1 AS (SELECT DISTINCT ON (user_id) * FROM ul ORDER BY user_id, created_at DESC),          -- representative lead: latest created
touches AS (
  SELECT ul.user_id, t.touch_id, t.touch_at, t.touch_date, t.touch_point, t.source, t.medium, t.campaign, t.staff, t.lead_id
  FROM ul JOIN analytics.mv_touch_flat t ON t.lead_id = ul.lead_id),
lt AS (
  SELECT DISTINCT ON (x.user_id) x.*
  FROM touches x JOIN pay p USING (user_id)
  WHERE x.touch_date <= p.last_payment_date
  ORDER BY x.user_id, x.touch_at DESC, x.touch_id DESC),
ntb AS (
  SELECT x.user_id, count(*)::int AS touches_before, count(*) FILTER (WHERE x.touch_date <= p.last_payment_date)::int AS touches_on_before
  FROM touches x JOIN pay p USING (user_id) GROUP BY 1)
SELECT p.user_id, p.phone_key, p.first_payment_date, p.last_payment_date, p.payments, p.revenue, p.courses, p.grades,
       lead1.lead_id, lead1.lead_name, lead1.lead_stage, lead1.class_raw, lead1.class_group, lead1.lead_source, lead1.owner_name, lead1.lm_reason, lead1.district,
       (lead1.lead_id IS NULL) AS no_lead,
       lt.touch_at AS last_touch_at, lt.touch_id AS last_touch_id, lt.lead_id AS last_touch_lead_id,
       COALESCE(lt.touch_point, 'No Touch Before Payment') AS last_touch_point,
       COALESCE(lt.source,      'No Touch Before Payment') AS last_touch_source,
       COALESCE(lt.medium,      'No Touch Before Payment') AS last_touch_medium,
       COALESCE(lt.campaign,    'No Touch Before Payment') AS last_touch_campaign,
       COALESCE(lt.staff,       CASE WHEN lt.touch_id IS NULL THEN 'No Touch Before Payment' ELSE '(Blank)' END) AS last_touch_staff,
       COALESCE(ntb.touches_on_before, 0) AS touches_before_payment,
       COALESCE(ntb.touches_before, 0)    AS touches_all
FROM pay p
LEFT JOIN lead1 USING (user_id)
LEFT JOIN lt    USING (user_id)
LEFT JOIN ntb   USING (user_id)
WITH NO DATA;
CREATE UNIQUE INDEX mv_payer_pk ON analytics.mv_payer (user_id);
CREATE INDEX mv_payer_last_pay ON analytics.mv_payer (last_payment_date);

CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE t0 timestamptz; n bigint; v text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN RAISE NOTICE 'refresh_all already running'; RETURN; END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY['analytics.mv_touch_flat', 'analytics.mv_payer'] LOOP
      t0 := clock_timestamp();
      n := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n; seconds := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all')); RAISE; END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;

SELECT analytics.refresh_one('analytics.mv_payer'::regclass) AS payer_rows;
SELECT pg_size_pretty(pg_total_relation_size('analytics.mv_payer')) AS payer_size, pg_size_pretty(pg_database_size(current_database())) AS db_total;
