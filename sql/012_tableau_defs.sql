-- 012 (2026-09-22): columns needed to reproduce the Tableau workbook's "Converted"
--   Tableau: COUNTD(IF valid payment AND payment_date >= touch date THEN lead)  -> ANY valid payment on/after the touch day
--   so each lead needs its LAST valid payment date, not only the first.
-- Adds columns at the end of v_lead_payment / v_lead_conv (CREATE OR REPLACE keeps dependents intact).
CREATE OR REPLACE VIEW analytics.v_lead_payment AS
SELECT l.id AS lead_id,
       min(vp.payment_date) AS converted_at,
       min(vp.payment_time) AS first_payment_time,
       count(*)             AS payment_count,
       sum(vp.total)        AS revenue,
       sum(COALESCE(vp.refund_amount, 0)) AS refunds,
       min(vp.user_id)      AS app_user_id,
       max(vp.payment_date) AS last_payment_date
FROM salesforce.lead_master__c l
JOIN analytics.v_valid_payment vp ON vp.phone_key = analytics.phone_key(l.mobile_number__c)
GROUP BY l.id;

CREATE OR REPLACE VIEW analytics.v_lead_conv AS
SELECT l.id AS lead_id, l.name AS lead_name, l.createddate AS created_at, analytics.ist_date(l.createddate) AS created_date,
    l.first_name__c AS first_name, l.last_name__c AS last_name, l.mobile_number__c AS mobile, l.email__c AS email,
    analytics.phone_key(l.mobile_number__c) AS phone_key, analytics.phone_key_valid(l.mobile_number__c) AS phone_valid,
    l.class__c AS class_raw, analytics.class_group(l.class__c) AS class_group,
    COALESCE(NULLIF(btrim(l.lead_source__c), ''), '(blank)') AS lead_source, l.lead_source_detail__c AS lead_source_detail,
    COALESCE(NULLIF(btrim(l.lead_stage__c), ''), '(blank)') AS lead_stage, l.lead_type__c AS lead_type, l.priority__c AS priority,
    l.district__c AS district, l.city__c AS city, l.state__c AS state,
    l.campaign_name__c AS campaign_name, l.campaign_quality__c AS campaign_quality, l.campaign_tag__c AS campaign_tag, l.campaign_date__c AS campaign_date,
    l.ad_platform__c AS ad_platform, l.ad_campaign__c AS ad_campaign, l.ad_set__c AS ad_set, l.ad_name__c AS ad_name, l.ad_class__c AS ad_class, l.ad_class_match__c AS ad_class_match,
    l.ownerid AS owner_id, COALESCE(u.name, l.ownerid::text) AS owner_name,
    l.enquiry_assigned_date__c AS enquiry_assigned_date, l.follow_up_date__c AS follow_up_date, l.next_followup_due__c AS next_followup_due,
    l.touch_count__c AS sf_touch_count, l.first_touch_date__c AS sf_first_touch_at, l.first_touch_point__c AS sf_first_touch_point,
    l.last_touch_date__c AS sf_last_touch_at, l.last_touch_point__c AS sf_last_touch_point,
    COALESCE(l.is_converted__c, false) AS sf_is_converted, l.converted_date__c AS sf_converted_at,
    l.converted_after_first_touch__c AS sf_converted_after_first_touch, l.customer_before_first_touch__c AS sf_customer_before_first_touch,
    l.ic_count__c AS ic_count, l.ic_enrolled_count__c AS ic_enrolled_count, l.best_ic_status__c AS best_ic_status, l.ic_course__c AS ic_course,
    l.enrollment_count__c AS enrollment_count, l.enrolled_value__c AS sf_enrolled_value,
    l.app_engagement_tier__c AS app_engagement_tier, l.app_time_30d_min__c AS app_time_30d_min, l.app_active_days_30d__c AS app_active_days_30d, l.app_last_active__c AS app_last_active,
    COALESCE(l.is_duplicate__c, false) AS is_duplicate, l.parent_lead_master__c AS parent_lead_id, l.lm_reason__c AS lm_reason,
    l.hot_lead__c AS hot_lead_date, l.supreme_hot__c AS supreme_hot_date, l.relogged_in__c AS relogged_in_date,
    (l.hot_lead__c IS NOT NULL) AS is_hot, (l.supreme_hot__c IS NOT NULL) AS is_supreme_hot, (l.relogged_in__c IS NOT NULL) AS is_relogged,
    (l.parent_lead_master__c IS NOT NULL) AS is_repeat,
    analytics.is_paid_lead(l.lead_source__c, l.gclid__c, l.fbclid__c, l.meta_lead_id__c, l.ad_platform__c) AS is_paid_lead,
    (l.gclid__c IS NOT NULL OR l.fbclid__c IS NOT NULL OR l.meta_lead_id__c IS NOT NULL) AS has_click_id,
    (p.lead_id IS NOT NULL) AS converted, p.converted_at, p.first_payment_time,
    COALESCE(p.payment_count, 0) AS payment_count, COALESCE(p.revenue, 0) AS revenue, COALESCE(p.refunds, 0) AS refunds, p.app_user_id,
    (p.converted_at - analytics.ist_date(l.createddate)) AS days_to_convert,
    (p.converted_at < analytics.ist_date(l.createddate)) AS pre_existing_customer,
    p.last_payment_date
FROM salesforce.lead_master__c l
LEFT JOIN salesforce."user" u ON u.id::text = l.ownerid::text
LEFT JOIN analytics.v_lead_payment p ON p.lead_id::text = l.id::text
WHERE COALESCE(l.is_deleted__c, false) = false AND COALESCE(l.isdeleted, false) = false;
