-- =====================================================================
-- 005_indexes.sql
-- Base-table indexes. Run BEFORE the first sync (tables are empty, so plain
-- CREATE INDEX is instant) - safe in the Supabase SQL editor or via psql:
--   psql "$OWNER_DATABASE_URL" -f sql/005_indexes.sql
-- =====================================================================

-- Salesforce replica ------------------------------------------------------
CREATE INDEX IF NOT EXISTS lead_touch_lead_date
  ON salesforce.lead_touch__c (lead_master__c, touch_date__c) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS lead_touch_date
  ON salesforce.lead_touch__c (touch_date__c) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS lead_touch_modstamp
  ON salesforce.lead_touch__c (systemmodstamp);

CREATE INDEX IF NOT EXISTS lead_master_created
  ON salesforce.lead_master__c (createddate) WHERE is_deleted__c = false AND isdeleted = false;
CREATE INDEX IF NOT EXISTS lead_master_phone_key
  ON salesforce.lead_master__c (analytics.phone_key(mobile_number__c));
CREATE INDEX IF NOT EXISTS lead_master_owner
  ON salesforce.lead_master__c (ownerid);
CREATE INDEX IF NOT EXISTS lead_master_parent
  ON salesforce.lead_master__c (parent_lead_master__c) WHERE parent_lead_master__c IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_master_modstamp
  ON salesforce.lead_master__c (systemmodstamp);

CREATE INDEX IF NOT EXISTS interested_course_lead
  ON salesforce.interested_course__c (lead_master__c) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS interested_course_modstamp
  ON salesforce.interested_course__c (systemmodstamp);

CREATE INDEX IF NOT EXISTS task_phone_key
  ON salesforce.task (analytics.phone_key(mobile_number__c)) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS task_owner_created
  ON salesforce.task (ownerid, createddate) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS task_modstamp
  ON salesforce.task (systemmodstamp);

-- App replica tables (schema app, filled by sync from the production DB) ------
-- Replica of the production tables; created empty by 001, so plain CREATE INDEX is fine.
-- The composite below lets the valid-payment scan be index-only.
CREATE INDEX IF NOT EXISTS home_payment_user_paydate_valid
  ON app.home_payment (user_id, payment_date)
  WHERE payment_method = 0 AND deleted = false AND is_success = true AND payment_success = true;

CREATE INDEX IF NOT EXISTS home_customuser_phone_key
  ON app.home_customuser (analytics.phone_key(phone)) WHERE is_deleted = false;

ANALYZE salesforce.lead_master__c;
ANALYZE salesforce.lead_touch__c;
ANALYZE salesforce.interested_course__c;
ANALYZE salesforce.task;
