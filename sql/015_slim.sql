-- =====================================================================
-- 015_slim.sql (2026-09-23)  Storage trim: drop lead / interested-course columns no page reads.
-- Run as a bundle: 015_slim  @@  012 (v_lead_payment + v_lead_conv)  @@  015b (v_ic_base, v_lead_calls)  @@  010  @@  014  @@  VACUUM FULL
-- The sync's field lists (sync/src/objects.ts) are trimmed to match, so the columns do not come back.
-- =====================================================================
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_payer;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_touch_flat;
DROP VIEW IF EXISTS analytics.v_lead_base;
DROP VIEW IF EXISTS analytics.v_touch_base;
DROP VIEW IF EXISTS analytics.v_lead_calls;
DROP VIEW IF EXISTS analytics.v_ic_base;
DROP VIEW IF EXISTS analytics.v_lead_conv;

ALTER TABLE salesforce.lead_master__c
  DROP COLUMN IF EXISTS lastmodifieddate,
  DROP COLUMN IF EXISTS lead_source_detail__c,
  DROP COLUMN IF EXISTS state__c,
  DROP COLUMN IF EXISTS campaign_name__c,
  DROP COLUMN IF EXISTS campaign_quality__c,
  DROP COLUMN IF EXISTS campaign_tag__c,
  DROP COLUMN IF EXISTS campaign_date__c,
  DROP COLUMN IF EXISTS ad_campaign__c,
  DROP COLUMN IF EXISTS ad_set__c,
  DROP COLUMN IF EXISTS ad_name__c,
  DROP COLUMN IF EXISTS ad_class__c,
  DROP COLUMN IF EXISTS ad_class_match__c,
  DROP COLUMN IF EXISTS enquiry_assigned_date__c,
  DROP COLUMN IF EXISTS follow_up_date__c,
  DROP COLUMN IF EXISTS next_followup_due__c,
  DROP COLUMN IF EXISTS first_touch_date__c,
  DROP COLUMN IF EXISTS first_touch_point__c,
  DROP COLUMN IF EXISTS last_touch_date__c,
  DROP COLUMN IF EXISTS last_touch_point__c,
  DROP COLUMN IF EXISTS converted_date__c,
  DROP COLUMN IF EXISTS converted_after_first_touch__c,
  DROP COLUMN IF EXISTS customer_before_first_touch__c,
  DROP COLUMN IF EXISTS days_to_convert__c,
  DROP COLUMN IF EXISTS ic_count__c,
  DROP COLUMN IF EXISTS ic_enrolled_count__c,
  DROP COLUMN IF EXISTS ic_course__c,
  DROP COLUMN IF EXISTS enrollment_count__c,
  DROP COLUMN IF EXISTS enrolled_value__c,
  DROP COLUMN IF EXISTS app_engagement_tier__c,
  DROP COLUMN IF EXISTS app_time_30d_min__c,
  DROP COLUMN IF EXISTS app_active_days_30d__c,
  DROP COLUMN IF EXISTS app_last_active__c,
  DROP COLUMN IF EXISTS hot_lead__c,
  DROP COLUMN IF EXISTS supreme_hot__c,
  DROP COLUMN IF EXISTS relogged_in__c;

ALTER TABLE salesforce.interested_course__c
  DROP COLUMN IF EXISTS fees_offered__c,
  DROP COLUMN IF EXISTS assigned_date__c,
  DROP COLUMN IF EXISTS target_customer__c,
  DROP COLUMN IF EXISTS ad_campaign__c,
  DROP COLUMN IF EXISTS occupation_categories__c,
  DROP COLUMN IF EXISTS ownerid,
  DROP COLUMN IF EXISTS lm_reason__c;

-- unused indexes (never / almost never read)
DROP INDEX IF EXISTS salesforce.lead_master_created;
DROP INDEX IF EXISTS salesforce.lead_master_modstamp;
