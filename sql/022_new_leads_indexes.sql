-- =====================================================================
-- 022_new_leads_indexes.sql (2026-09-26)  Indexes for the "New leads" KPI (leads created in the window, touched or not)
-- The KPI, its list and its summary read salesforce.lead_master__c by creation time; without an index every call
-- scanned all ~380k leads and the planner misestimated the range (nested loops everywhere).
-- home_payment(user_id) speeds up every drawer's purchased grade / course split; mv_payer(phone_key) the payer lookup by phone.
-- NOTE: analytics.mv_payer is rebuilt by rename in 017/021-style scripts - recreate mv_payer_phone after any such swap.
-- =====================================================================
CREATE INDEX IF NOT EXISTS lead_master_createddate ON salesforce.lead_master__c (createddate);
@@
CREATE INDEX IF NOT EXISTS home_payment_user ON app.home_payment (user_id);
@@
CREATE INDEX IF NOT EXISTS mv_payer_phone ON analytics.mv_payer (phone_key);
@@
ANALYZE salesforce.lead_master__c;
@@
ANALYZE app.home_payment;
@@
SELECT indexname, pg_size_pretty(pg_relation_size(('salesforce.' || indexname)::regclass)) AS size FROM pg_indexes WHERE schemaname = 'salesforce' AND tablename = 'lead_master__c'
UNION ALL SELECT indexname, pg_size_pretty(pg_relation_size(('app.' || indexname)::regclass)) FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'home_payment'
UNION ALL SELECT indexname, pg_size_pretty(pg_relation_size(('analytics.' || indexname)::regclass)) FROM pg_indexes WHERE schemaname = 'analytics' AND tablename = 'mv_payer';
