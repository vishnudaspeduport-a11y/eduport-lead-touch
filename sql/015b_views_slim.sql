-- 015b: views recreated after the column trim (run after 012 recreated v_lead_conv)
CREATE VIEW analytics.v_ic_base AS
SELECT ic.id AS ic_id, ic.lead_master__c AS lead_id, ic.course__c AS course_id,
       COALESCE(NULLIF(ic.course_name__c, ''), cr.name, ic.course__c::text) AS course_name,
       COALESCE(NULLIF(btrim(ic.status__c), ''), '(blank)') AS status,
       COALESCE(ic.is_enrolled__c, false) AS is_enrolled,
       ic.createddate AS ic_created_at
FROM salesforce.interested_course__c ic
LEFT JOIN salesforce.course__c cr ON cr.id::text = ic.course__c::text
WHERE COALESCE(ic.isdeleted, false) = false AND ic.lead_master__c IS NOT NULL;

CREATE VIEW analytics.v_lead_calls AS
SELECT l.lead_id, count(*) AS task_count,
       count(*) FILTER (WHERE tv.is_call) AS call_attempts,
       count(*) FILTER (WHERE tv.is_call AND tv.is_connected) AS calls_connected,
       sum(tv.call_seconds) FILTER (WHERE tv.is_connected) AS call_seconds_total,
       avg(tv.call_seconds) FILTER (WHERE tv.is_connected AND tv.call_seconds > 0) AS call_seconds_avg,
       min(tv.call_start_at) AS first_call_at,
       max(COALESCE(tv.call_start_at, tv.task_created_at)) AS last_task_at,
       (array_agg(tv.reason ORDER BY tv.task_created_at DESC) FILTER (WHERE tv.reason IS NOT NULL))[1] AS last_reason
FROM analytics.v_lead_conv l JOIN analytics.v_task_valid tv ON tv.phone_key = l.phone_key
GROUP BY l.lead_id;
