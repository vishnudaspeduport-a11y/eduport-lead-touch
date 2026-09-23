-- 012 (2026-09-22): columns needed to reproduce the Tableau workbook's "Converted"
--   Tableau: COUNTD(IF valid payment AND payment_date >= touch date THEN lead)  -> ANY valid payment on/after the touch day
--   so each lead needs its LAST valid payment date, not only the first.
-- Adds columns at the end of v_lead_payment / v_lead_conv (CREATE OR REPLACE keeps dependents intact).
CREATE OR REPLACE VIEW analytics.v_lead_payment AS
SELECT l.id AS lead_id,
       min(vp.payment_date) AS converted_at,
       min(vp.payment_time) AS first_payment_time,
       count(*)             AS payment_count,
       sum(vp.amount)       AS revenue,   -- amount, not total: gateway-2 payment-link rows carry the money in amount/fee and leave total = 0
       sum(COALESCE(vp.refund_amount, 0)) AS refunds,
       min(vp.user_id)      AS app_user_id,
       max(vp.payment_date) AS last_payment_date,
       max(vp.payment_date) FILTER (WHERE vp.amount > 0) AS last_paid_payment_date,   -- kept for compatibility (view columns cannot be dropped in place); unused
       string_agg(DISTINCT COALESCE(b.title, 'batch ' || vp.batch_id::text), ' | ') AS courses,
       -- moment of the last valid payment: payment_time if recorded, else the record's creation time when it is on the payment day,
       -- else the end of the payment day (IST) so that any touch on that day counts as "before the payment"
       max(CASE WHEN vp.payment_time IS NOT NULL THEN vp.payment_time
                WHEN (vp.payment_created AT TIME ZONE 'Asia/Kolkata')::date = vp.payment_date THEN vp.payment_created
                ELSE ((vp.payment_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') END) AS last_payment_at
FROM salesforce.lead_master__c l
JOIN analytics.v_valid_payment vp ON vp.phone_key = analytics.phone_key(l.mobile_number__c)
LEFT JOIN app.core_batch b ON b.id = vp.batch_id
GROUP BY l.id;

CREATE OR REPLACE VIEW analytics.v_lead_conv AS
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
    (l.gclid__c IS NOT NULL OR l.fbclid__c IS NOT NULL OR l.meta_lead_id__c IS NOT NULL) AS has_click_id,
    (p.lead_id IS NOT NULL) AS converted, p.converted_at, p.first_payment_time,
    COALESCE(p.payment_count, 0) AS payment_count, COALESCE(p.revenue, 0) AS revenue, COALESCE(p.refunds, 0) AS refunds, p.app_user_id,
    (p.converted_at - analytics.ist_date(l.createddate)) AS days_to_convert,
    (p.converted_at < analytics.ist_date(l.createddate)) AS pre_existing_customer,
    p.last_payment_date,
    p.last_paid_payment_date,
    p.courses,
    p.last_payment_at
FROM salesforce.lead_master__c l
LEFT JOIN salesforce."user" u ON u.id::text = l.ownerid::text
LEFT JOIN analytics.v_lead_payment p ON p.lead_id::text = l.id::text
WHERE COALESCE(l.is_deleted__c, false) = false AND COALESCE(l.isdeleted, false) = false;
