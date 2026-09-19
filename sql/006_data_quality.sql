-- =====================================================================
-- 006_data_quality.sql   (run as postgres in the Supabase SQL editor, after 004)
-- Every check is a view returning the offending rows; v_dq_summary counts them.
-- The API exposes /api/data-quality (summary) and /api/data-quality/:check (rows).
-- =====================================================================
SET search_path = analytics, public;

-- 1. Leads with no touches at all
CREATE OR REPLACE VIEW analytics.dq_leads_no_touches AS
SELECT lead_id, lead_name, created_date, lead_source, lead_stage, owner_name, class_group, converted
FROM analytics.mv_lead_base WHERE total_touches = 0;

-- 2. Touches whose Lead_Master__c is missing or points at a missing / deleted lead
CREATE OR REPLACE VIEW analytics.dq_orphan_touches AS
SELECT t.id AS touch_id, t.lead_master__c AS lead_id, t.touch_date__c AS touch_at, t.touch_point__c AS touch_point,
       t.source__c AS source, t.campaign__c AS campaign,
       CASE WHEN t.lead_master__c IS NULL THEN 'null lead id'
            WHEN l.id IS NULL THEN 'lead not found'
            ELSE 'lead deleted' END AS problem
FROM salesforce.lead_touch__c t
LEFT JOIN salesforce.lead_master__c l ON l.id = t.lead_master__c
WHERE COALESCE(t.isdeleted,false) = false
  AND (t.lead_master__c IS NULL OR l.id IS NULL OR l.is_deleted__c OR l.isdeleted);

-- 3. Lead phone numbers that do not normalise to a 10-digit Indian mobile
CREATE OR REPLACE VIEW analytics.dq_bad_lead_phones AS
SELECT lead_id, lead_name, created_date, lead_source, mobile AS raw_phone, phone_key,
       CASE WHEN mobile IS NULL OR btrim(mobile) = '' THEN 'blank'
            WHEN phone_key IS NULL THEN 'fewer than 10 digits'
            ELSE 'not 6-9xxxxxxxxx' END AS problem
FROM analytics.mv_lead_base WHERE NOT COALESCE(phone_valid,false);

-- 4. App users with payments whose phone does not normalise
CREATE OR REPLACE VIEW analytics.dq_bad_user_phones AS
SELECT u.id AS user_id, u.phone AS raw_phone, analytics.phone_key(u.phone) AS phone_key, count(vp.payment_id) AS valid_payments
FROM app.home_customuser u
JOIN analytics.v_valid_payment vp ON vp.user_id = u.id
WHERE NOT COALESCE(analytics.phone_key_valid(u.phone), false)
GROUP BY u.id, u.phone;

-- 5. Valid payments with no matching lead (by phone)
CREATE OR REPLACE VIEW analytics.dq_payments_no_lead AS
SELECT vp.payment_id, vp.user_id, vp.phone_key, vp.payment_date, vp.total, vp.course_new_id
FROM analytics.v_valid_payment vp
WHERE vp.phone_key IS NULL
   OR NOT EXISTS (SELECT 1 FROM analytics.mv_lead_base l WHERE l.phone_key = vp.phone_key);

-- 6a. Leads flagged duplicate in Salesforce
CREATE OR REPLACE VIEW analytics.dq_flagged_duplicates AS
SELECT lead_id, lead_name, created_date, phone_key, lead_source, parent_lead_id, converted
FROM analytics.mv_lead_base WHERE is_duplicate;

-- 6b. Same phone appearing on >1 non-duplicate lead (undetected duplicates)
CREATE OR REPLACE VIEW analytics.dq_phone_collisions AS
SELECT phone_key, count(*) AS leads, min(created_date) AS first_created, max(created_date) AS last_created,
       bool_or(converted) AS any_converted, array_agg(lead_id ORDER BY created_date) AS lead_ids
FROM analytics.mv_lead_base
WHERE phone_key IS NOT NULL AND NOT is_duplicate
GROUP BY phone_key HAVING count(*) > 1;

-- 7. Touch_Count__c on the lead disagrees with the actual number of touches
CREATE OR REPLACE VIEW analytics.dq_touch_count_mismatch AS
SELECT lead_id, lead_name, created_date, sf_touch_count, total_touches, (total_touches - sf_touch_count) AS diff
FROM analytics.mv_lead_base WHERE sf_touch_count_mismatch;

-- 8. Conversions where the payment predates the first touch (pre-existing customers)
CREATE OR REPLACE VIEW analytics.dq_paid_before_first_touch AS
SELECT lead_id, lead_name, created_date, converted_at, first_touch_date, (first_touch_date - converted_at) AS days_payment_before_touch,
       lead_source, first_touch_point, revenue
FROM analytics.mv_lead_base WHERE paid_before_first_touch;

-- 8b. Conversions where the payment predates the lead itself
CREATE OR REPLACE VIEW analytics.dq_paid_before_created AS
SELECT lead_id, lead_name, created_date, converted_at, (created_date - converted_at) AS days_payment_before_lead, lead_source, revenue
FROM analytics.mv_lead_base WHERE pre_existing_customer;

-- 9. Salesforce Is_Converted__c disagrees with the payment-based definition
CREATE OR REPLACE VIEW analytics.dq_sf_converted_mismatch AS
SELECT lead_id, lead_name, created_date, sf_is_converted, converted, converted_at, sf_converted_at, lead_stage, revenue
FROM analytics.mv_lead_base WHERE sf_converted_mismatch;

-- 10. Touches with blank touch point / source
CREATE OR REPLACE VIEW analytics.dq_blank_touch_attrs AS
SELECT touch_id, lead_id, touch_at, touch_point, source, medium, campaign
FROM analytics.mv_touch_base WHERE touch_point = '(blank)' OR source = '(blank)';

-- 11. Class values that fall into Unknown / Other (mapping coverage)
CREATE OR REPLACE VIEW analytics.dq_unmapped_class AS
SELECT class_raw, class_group, count(*) AS leads, count(*) FILTER (WHERE converted) AS converted
FROM analytics.mv_lead_base WHERE class_group IN ('Unknown','Other')
GROUP BY class_raw, class_group ORDER BY leads DESC;

-- Summary ------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_dq_summary AS
SELECT * FROM (VALUES
  ('leads_no_touches',        'Leads with no touches',                              (SELECT count(*) FROM analytics.dq_leads_no_touches),        (SELECT count(*) FROM analytics.mv_lead_base)),
  ('orphan_touches',          'Touches with missing / invalid Lead_Master__c',      (SELECT count(*) FROM analytics.dq_orphan_touches),          (SELECT count(*) FROM salesforce.lead_touch__c WHERE NOT isdeleted)),
  ('bad_lead_phones',         'Lead phones that fail to normalise',                 (SELECT count(*) FROM analytics.dq_bad_lead_phones),         (SELECT count(*) FROM analytics.mv_lead_base)),
  ('bad_user_phones',         'Paying app users whose phone fails to normalise',    (SELECT count(*) FROM analytics.dq_bad_user_phones),         (SELECT count(DISTINCT user_id) FROM analytics.v_valid_payment)),
  ('payments_no_lead',        'Valid payments with no matching lead',               (SELECT count(*) FROM analytics.dq_payments_no_lead),        (SELECT count(*) FROM analytics.v_valid_payment)),
  ('flagged_duplicates',      'Leads flagged Is_Duplicate__c',                      (SELECT count(*) FROM analytics.dq_flagged_duplicates),      (SELECT count(*) FROM analytics.mv_lead_base)),
  ('phone_collisions',        'Phones shared by >1 non-duplicate lead',             (SELECT count(*) FROM analytics.dq_phone_collisions),        (SELECT count(DISTINCT phone_key) FROM analytics.mv_lead_base)),
  ('touch_count_mismatch',    'Touch_Count__c differs from actual touches',         (SELECT count(*) FROM analytics.dq_touch_count_mismatch),    (SELECT count(*) FROM analytics.mv_lead_base)),
  ('paid_before_first_touch', 'Conversions with payment before first touch',        (SELECT count(*) FROM analytics.dq_paid_before_first_touch), (SELECT count(*) FROM analytics.mv_lead_base WHERE converted)),
  ('paid_before_created',     'Conversions with payment before lead creation',      (SELECT count(*) FROM analytics.dq_paid_before_created),     (SELECT count(*) FROM analytics.mv_lead_base WHERE converted)),
  ('sf_converted_mismatch',   'Is_Converted__c disagrees with payment definition',  (SELECT count(*) FROM analytics.dq_sf_converted_mismatch),   (SELECT count(*) FROM analytics.mv_lead_base)),
  ('blank_touch_attrs',       'Touches with blank touch point or source',           (SELECT count(*) FROM analytics.dq_blank_touch_attrs),       (SELECT count(*) FROM analytics.mv_touch_base)),
  ('unmapped_class',          'Leads in class group Unknown / Other',               (SELECT count(*) FROM analytics.mv_lead_base WHERE class_group IN ('Unknown','Other')), (SELECT count(*) FROM analytics.mv_lead_base))
) AS v(check_key, label, bad_rows, total_rows);

GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO lt_app_ro, lt_analytics_owner;
