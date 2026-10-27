-- 040 (2026-10-27): Overview fee KPIs read the phone key of each selected lead from this covering index (index-only, resident)
-- instead of probing salesforce.lead_master__c and recomputing analytics.phone_key() per lead (1.7 s -> 0.3 s for a 30-day window).
CREATE INDEX IF NOT EXISTS mv_lead_lite_pk_phone ON analytics.mv_lead_lite (lead_id) INCLUDE (phone_key, phone_valid);
ANALYZE analytics.mv_lead_lite;
