-- 033 (2026-10-15): analytics.v_lead_lite = the lead columns of v_lead_conv WITHOUT the payment join.
-- v_lead_conv LEFT JOINs v_lead_payment (an aggregate over every payer); counts and id selections over hundreds of
-- thousands of leads (Total leads on the created basis, New leads, the New-leads list and summary) only need the lead
-- itself, so they read this view and keep payment lookups per row / per page. Column expressions are identical to
-- v_lead_conv so filters built for one apply to the other.
CREATE OR REPLACE VIEW analytics.v_lead_lite AS
SELECT l.id AS lead_id, l.name AS lead_name, l.createddate AS created_at, analytics.ist_date(l.createddate) AS created_date,
    l.first_name__c AS first_name, l.last_name__c AS last_name, l.mobile_number__c AS mobile, l.email__c AS email,
    analytics.phone_key(l.mobile_number__c) AS phone_key, analytics.phone_key_valid(l.mobile_number__c) AS phone_valid,
    l.class__c AS class_raw, analytics.class_group(l.class__c) AS class_group,
    COALESCE(NULLIF(btrim(l.lead_source__c), ''), '(blank)') AS lead_source,
    COALESCE(NULLIF(btrim(l.lead_stage__c), ''), '(blank)') AS lead_stage, l.lead_type__c AS lead_type, l.priority__c AS priority,
    l.district__c AS district, l.city__c AS city,
    l.ad_platform__c AS ad_platform,
    l.ownerid AS owner_id, COALESCE(u.name, l.ownerid::text) AS owner_name,
    l.touch_count__c AS sf_touch_count,
    COALESCE(l.is_converted__c, false) AS sf_is_converted,
    l.best_ic_status__c AS best_ic_status,
    COALESCE(l.is_duplicate__c, false) AS is_duplicate, l.parent_lead_master__c AS parent_lead_id, l.lm_reason__c AS lm_reason,
    (l.parent_lead_master__c IS NOT NULL) AS is_repeat,
    analytics.is_paid_lead(l.lead_source__c, l.gclid__c, l.fbclid__c, l.meta_lead_id__c, l.ad_platform__c) AS is_paid_lead,
    (l.gclid__c IS NOT NULL OR l.fbclid__c IS NOT NULL OR l.meta_lead_id__c IS NOT NULL) AS has_click_id
FROM salesforce.lead_master__c l
LEFT JOIN salesforce."user" u ON u.id::text = l.ownerid::text
WHERE COALESCE(l.is_deleted__c, false) = false AND COALESCE(l.isdeleted, false) = false;

SELECT count(*) AS lite_rows FROM analytics.v_lead_lite;
