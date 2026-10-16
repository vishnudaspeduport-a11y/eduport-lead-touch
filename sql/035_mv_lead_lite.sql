-- 035 (2026-10-16): analytics.mv_lead_lite - a narrow materialized copy of the lead columns the Overview counts need.
-- "Total leads" on the created basis counts leads created in the window OR touched in it. The planner answers that with a
-- hash join that sequentially scans the whole lead table (827k wide rows, ~1 s alone and 2-6 s when the Overview's other
-- 20 queries run beside it), and it was the slowest statement on every filter change. A row here is a fraction of the
-- width, so the same scan costs a few hundred milliseconds. Refreshed by refresh_all() with the other precomputes.
-- Lists, searches and the lead detail keep reading v_lead_lite / v_lead_conv (names, phone, e-mail are not here).
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_lead_lite AS
SELECT lead_id, created_at, created_date, phone_key, phone_valid, class_raw, class_group, lead_source, lead_stage, lead_type, priority,
       district, city, ad_platform, owner_id, owner_name, sf_is_converted, best_ic_status, is_duplicate, parent_lead_id, lm_reason,
       is_repeat, is_paid_lead
FROM analytics.v_lead_lite
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_lead_lite_pk      ON analytics.mv_lead_lite (lead_id);
-- covering indexes: the Overview counts (New leads, Total leads on the created basis) never touch the heap. On the 1 GB instance
-- the heap (167 MB) is evicted from memory between requests; a 30 MB index stays resident.
CREATE INDEX IF NOT EXISTS mv_lead_lite_created_inc   ON analytics.mv_lead_lite (created_at) INCLUDE (lead_id, is_duplicate);
CREATE INDEX IF NOT EXISTS mv_lead_lite_nodup         ON analytics.mv_lead_lite (lead_id) WHERE is_duplicate = false;
CREATE INDEX IF NOT EXISTS mv_lead_lite_phone         ON analytics.mv_lead_lite (phone_key);
ANALYZE analytics.mv_lead_lite;

CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE t0 timestamptz; n bigint; v text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN RAISE NOTICE 'refresh_all already running'; RETURN; END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY['analytics.mv_user_phone', 'analytics.mv_ujra_payment', 'analytics.mv_lead_lite', 'analytics.mv_touch_flat', 'analytics.mv_payer'] LOOP
      t0 := clock_timestamp();
      n := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n; seconds := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all')); RAISE; END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;

SELECT (SELECT count(*) FROM analytics.mv_lead_lite) AS lead_lite_rows, pg_size_pretty(pg_total_relation_size('analytics.mv_lead_lite')) AS size,
       pg_size_pretty(pg_total_relation_size('salesforce.lead_master__c')) AS lead_master_size;
