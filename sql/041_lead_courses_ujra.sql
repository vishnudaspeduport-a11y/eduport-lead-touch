-- 041 (2026-10-29): the lead's course list (v_lead_payment.courses -> v_lead_conv -> mv_touch_flat.courses, the "Course / Batch" column of
-- the lead lists) fell back to 'batch <id>' and so showed NOTHING for Ujra bookings (no app batch). Now the Ujra course label is used.
-- Same definition as sql/025 except the courses expression. Refresh analytics.mv_touch_flat afterwards.
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
       string_agg(DISTINCT COALESCE(b.title, vp.course_label, 'batch ' || vp.batch_id::text), ' | ') AS courses,
       -- moment of the last valid payment: payment_time if recorded, else the record's creation time when it is on the payment day,
       -- else the end of the payment day (IST) so that any touch on that day counts as "before the payment"
       max(CASE WHEN vp.payment_time IS NOT NULL THEN vp.payment_time
                WHEN (vp.payment_created AT TIME ZONE 'Asia/Kolkata')::date = vp.payment_date THEN vp.payment_created
                ELSE ((vp.payment_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') END) AS last_payment_at
FROM salesforce.lead_master__c l
-- 025: the paying account's own phone OR its alternative number (v_valid_payment_x has one row per payment and phone key)
JOIN analytics.v_valid_payment_x vp ON vp.phone_key = analytics.phone_key(l.mobile_number__c)
LEFT JOIN app.core_batch b ON b.id = vp.batch_id
GROUP BY l.id;
