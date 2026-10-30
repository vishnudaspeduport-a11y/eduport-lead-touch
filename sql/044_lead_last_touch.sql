-- 044 (2026-10-30): the all-time last touch of every touched lead, precomputed.
-- Four Overview statements (stale leads, re-touched after a closed stage, the revised stage funnel, the revised IC funnel) looked
-- it up with a correlated max() over mv_touch_flat per lead of the selection: on a month of the touch basis that is ~40k index
-- probes in each of them, several seconds of a fan-out that already runs two dozen statements on a two-core database.
-- One small materialized view (one row per touched lead, ~160k rows) joined on its primary key replaces the probes; refreshed by
-- refresh_all() right after mv_touch_flat (its only source).
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_lead_last_touch AS
SELECT lead_id, max(touch_at) AS last_touch_at, min(touch_at) AS first_touch_at, count(*)::int AS touches
FROM analytics.mv_touch_flat
GROUP BY lead_id
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_lead_last_touch_pk ON analytics.mv_lead_last_touch (lead_id);
ANALYZE analytics.mv_lead_last_touch;

-- refresh order: sources first, then the big ones, then the per-lead summary of mv_touch_flat
CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE t0 timestamptz; n bigint; v text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN RAISE NOTICE 'refresh_all already running'; RETURN; END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY['analytics.mv_user_phone', 'analytics.mv_ujra_payment', 'analytics.mv_lead_lite', 'analytics.mv_touch_flat', 'analytics.mv_lead_last_touch', 'analytics.mv_payer'] LOOP
      t0 := clock_timestamp();
      n := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n; seconds := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all')); RAISE; END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;
