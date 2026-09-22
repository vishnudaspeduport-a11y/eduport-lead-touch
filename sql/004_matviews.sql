-- =====================================================================
-- 004_matviews.sql   (run as postgres in the Supabase SQL editor, after 002 + 003)
--
-- Materialized views the API reads. They are exact snapshots of the views
-- in 003 so the definitions live in ONE place; MVs only add indexes and a
-- refresh log. Refresh with:  SELECT * FROM analytics.refresh_all();
-- (SECURITY DEFINER, so the read-only role used by the Worker Cron Trigger
--  can call it.)
-- =====================================================================
SET search_path = analytics, public;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_daily_lead_stats;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lead_base;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_touch_base;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lead_calls;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_ic_base;

CREATE MATERIALIZED VIEW analytics.mv_touch_base AS SELECT * FROM analytics.v_touch_base WITH NO DATA;
CREATE MATERIALIZED VIEW analytics.mv_lead_base  AS SELECT * FROM analytics.v_lead_base  WITH NO DATA;
CREATE MATERIALIZED VIEW analytics.mv_lead_calls AS SELECT * FROM analytics.v_lead_calls WITH NO DATA;
CREATE MATERIALIZED VIEW analytics.mv_ic_base    AS SELECT * FROM analytics.v_ic_base    WITH NO DATA;

-- Pre-aggregated daily stats on the lead-created basis. The API uses this for
-- the Overview trend whenever the active filters are a subset of its
-- dimensions, and falls back to mv_lead_base otherwise.
CREATE MATERIALIZED VIEW analytics.mv_daily_lead_stats AS
SELECT
  created_date,
  lead_source, class_group, lead_stage, owner_name, district, is_duplicate, is_paid_lead,
  count(*)                                       AS leads,
  count(*) FILTER (WHERE converted)              AS converted,
  count(*) FILTER (WHERE converted AND NOT pre_existing_customer) AS converted_new,
  count(*) FILTER (WHERE first_touch_conversion) AS first_touch_conversions,
  count(*) FILTER (WHERE contacted)              AS contacted,
  sum(total_touches)                             AS total_touches,
  sum(valid_touches)                             AS valid_touches,
  sum(valid_touches) FILTER (WHERE converted)    AS touches_to_convert_sum,
  sum(revenue)                                   AS revenue,
  sum(days_to_convert) FILTER (WHERE converted AND days_to_convert >= 0) AS days_to_convert_sum,
  count(*) FILTER (WHERE converted AND days_to_convert >= 0)             AS days_to_convert_n,
  count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 7)  AS converted_7d,
  count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 30) AS converted_30d
FROM analytics.mv_lead_base
GROUP BY 1,2,3,4,5,6,7,8
WITH NO DATA;

-- Unique indexes are REQUIRED for REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX mv_touch_base_pk ON analytics.mv_touch_base (touch_id);
CREATE UNIQUE INDEX mv_lead_base_pk  ON analytics.mv_lead_base  (lead_id);
CREATE UNIQUE INDEX mv_lead_calls_pk ON analytics.mv_lead_calls (lead_id);
CREATE UNIQUE INDEX mv_ic_base_pk    ON analytics.mv_ic_base    (ic_id);
CREATE UNIQUE INDEX mv_daily_lead_stats_pk ON analytics.mv_daily_lead_stats
  (created_date, lead_source, class_group, lead_stage, owner_name, district, is_duplicate, is_paid_lead);

-- Query indexes (the API filters by these constantly)
CREATE INDEX mv_lead_base_created      ON analytics.mv_lead_base (created_date) INCLUDE (converted, revenue, valid_touches, is_duplicate);
CREATE INDEX mv_lead_base_converted_at ON analytics.mv_lead_base (converted_at) WHERE converted;
CREATE INDEX mv_lead_base_source       ON analytics.mv_lead_base (lead_source, created_date);
CREATE INDEX mv_lead_base_owner        ON analytics.mv_lead_base (owner_id, created_date);
CREATE INDEX mv_lead_base_class        ON analytics.mv_lead_base (class_group, created_date);
CREATE INDEX mv_lead_base_stage        ON analytics.mv_lead_base (lead_stage, created_date);
CREATE INDEX mv_lead_base_phone        ON analytics.mv_lead_base (phone_key);
CREATE INDEX mv_lead_base_name_trgm    ON analytics.mv_lead_base (lower(lead_name));
CREATE INDEX mv_lead_base_open_last    ON analytics.mv_lead_base (last_touch_any_at) WHERE is_open;

CREATE INDEX mv_touch_base_lead        ON analytics.mv_touch_base (lead_id, touch_at);
CREATE INDEX mv_touch_base_date        ON analytics.mv_touch_base (touch_date) INCLUDE (lead_id, is_pre_conversion);
CREATE INDEX mv_touch_base_point       ON analytics.mv_touch_base (touch_point, touch_date);
CREATE INDEX mv_touch_base_lead_created ON analytics.mv_touch_base (lead_created_date);
CREATE INDEX mv_touch_base_staff       ON analytics.mv_touch_base (staff) WHERE staff IS NOT NULL;

CREATE INDEX mv_ic_base_lead           ON analytics.mv_ic_base (lead_id);
CREATE INDEX mv_daily_lead_stats_date  ON analytics.mv_daily_lead_stats (created_date);

-- ---------------------------------------------------------------------
-- Refresh bookkeeping ("data as of" in the UI header)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.refresh_log (
  id           bigserial PRIMARY KEY,
  view_name    text        NOT NULL,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  ok           boolean,
  row_count    bigint,
  error        text
);
CREATE INDEX IF NOT EXISTS refresh_log_view_time ON analytics.refresh_log (view_name, started_at DESC);

CREATE OR REPLACE FUNCTION analytics.refresh_one(v regclass) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE
  log_id     bigint;
  populated  boolean;
  n          bigint;
BEGIN
  INSERT INTO analytics.refresh_log(view_name, started_at) VALUES (v::text, clock_timestamp()) RETURNING id INTO log_id;
  SELECT ispopulated INTO populated FROM pg_matviews
   WHERE schemaname = 'analytics' AND matviewname = split_part(v::text, '.', 2);
  IF populated THEN
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %s', v);
  ELSE
    EXECUTE format('REFRESH MATERIALIZED VIEW %s', v);
  END IF;
  EXECUTE format('SELECT count(*) FROM %s', v) INTO n;
  UPDATE analytics.refresh_log SET finished_at = clock_timestamp(), ok = true, row_count = n WHERE id = log_id;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  UPDATE analytics.refresh_log SET finished_at = clock_timestamp(), ok = false, error = SQLERRM WHERE id = log_id;
  RAISE;
END $$;

-- Refresh everything in dependency order. Returns one row per MV.
CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE
  v   text;
  t0  timestamptz;
  n   bigint;
BEGIN
  -- Prevent two overlapping refreshes (Cron + manual)
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN
    RAISE NOTICE 'refresh_all already running';
    RETURN;
  END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY[
      'analytics.mv_touch_base',
      'analytics.mv_lead_base',
      'analytics.mv_lead_calls'] LOOP
      t0 := clock_timestamp();
      n  := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n;
      seconds   := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
    RAISE;
  END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;

REVOKE ALL ON FUNCTION analytics.refresh_one(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.refresh_all()         FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.refresh_all() TO lt_app_ro, lt_analytics_owner;

-- "data as of": last successful refresh of mv_lead_base + last sync watermark
CREATE OR REPLACE VIEW analytics.v_data_as_of AS
SELECT
  (SELECT max(finished_at) FROM analytics.refresh_log WHERE ok AND view_name IN ('analytics.mv_lead_base','mv_lead_base')) AS refreshed_at,
  (SELECT min(last_modstamp) FROM salesforce._sync_state WHERE object_name IN ('Lead_Master__c','Lead_Touch__c')) AS salesforce_as_of,
  (SELECT max(last_run_at) FROM salesforce._sync_state) AS last_sync_run_at,
  (SELECT max(_synced_at) FROM salesforce.lead_master__c) AS lead_master_synced_at,
  (SELECT count(*) FROM analytics.mv_lead_base)  AS lead_rows,
  (SELECT count(*) FROM analytics.mv_touch_base) AS touch_rows;

GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO lt_app_ro, lt_analytics_owner;

-- First population (non-concurrent because the MVs are empty)
SELECT * FROM analytics.refresh_all();
