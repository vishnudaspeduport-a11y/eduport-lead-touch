-- 011: v_data_as_of without full-table counts (planner estimates are enough for a header badge)
CREATE OR REPLACE VIEW analytics.v_data_as_of AS
SELECT (SELECT max(finished_at) FROM analytics.refresh_log WHERE ok) AS refreshed_at,
       (SELECT min(last_modstamp) FROM salesforce._sync_state WHERE object_name IN ('Lead_Master__c','Lead_Touch__c')) AS salesforce_as_of,
       (SELECT max(last_run_at) FROM salesforce._sync_state) AS last_sync_run_at,
       (SELECT max(last_run_at) FROM salesforce._sync_state WHERE object_name = 'Lead_Master__c') AS lead_master_synced_at,
       (SELECT reltuples::bigint FROM pg_class WHERE oid = 'salesforce.lead_master__c'::regclass) AS lead_rows,
       (SELECT reltuples::bigint FROM pg_class WHERE oid = 'salesforce.lead_touch__c'::regclass) AS touch_rows;
