-- 036 (2026-10-23): refresh_one never actually refreshed CONCURRENTLY.
-- It looked the view up in pg_matviews by split_part(v::text, '.', 2); with analytics on the search_path the regclass prints
-- without its schema, the lookup found nothing, "populated" stayed NULL and the plain REFRESH ran every time. A plain
-- refresh takes an ACCESS EXCLUSIVE lock for its whole duration (readers blocked for 20-70 s after every sync), and with
-- five views refreshed inside the one refresh_all() transaction it deadlocked twice against Overview queries that join
-- two of the views (2026-10-19 and 2026-10-21: "Process waits for AccessExclusiveLock on mv_touch_flat ...").
-- The populated flag now comes from pg_class by OID; every view has the unique index CONCURRENTLY needs.
CREATE OR REPLACE FUNCTION analytics.refresh_one(v regclass) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE
  log_id     bigint;
  populated  boolean;
  n          bigint;
  vname      text;
BEGIN
  SELECT n.nspname || '.' || c.relname, c.relispopulated INTO vname, populated
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = v;
  INSERT INTO analytics.refresh_log(view_name, started_at) VALUES (vname, clock_timestamp()) RETURNING id INTO log_id;
  IF COALESCE(populated, false) THEN
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

-- every refreshed view must carry a unique index for CONCURRENTLY
SELECT c.relname, c.relispopulated,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique) AS has_unique_index
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'analytics' AND c.relkind = 'm' ORDER BY 1;
