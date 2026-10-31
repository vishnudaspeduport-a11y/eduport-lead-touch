-- 045 (2026-10-31): the revised funnels' verdict per lead and per interested course, precomputed.
--
-- Rule (both Revised funnels on the Overview): the LATEST STATUS DECISION AFTER THE LEAD'S LAST TOUCH decides, whichever object it was
-- made on. A Lead Stage change after the last touch that is later than any Interested Course status change keeps the lead in that stage
-- (and puts its courses under that stage); an Interested Course status change after the last touch that is later than the Lead Stage
-- change puts the lead under that IC status (and keeps the course under its status). With no decision after the last touch, a lead
-- parked in Connected / Not Willing Now / Disqualified / Not Connected / P2 Completed counts as New on the LM funnel and a course parked
-- in Not Interested / May Buy Later counts as New on the IC funnel; everything else keeps its own value. Converted leads stay Converted.
-- Stage moment = latest field-history change into the current Lead Stage (salesforce.lead_stage, history from 1 March 2026), else the later
-- of the lead's creation time and 1 March 2026; IC status moment likewise from salesforce.ic_status, else the IC's creation time.
--
-- The verdict depends only on all-time facts (last touch, stage/status moments), never on the dashboard filters, so it is computed once per
-- refresh for every touched lead (mv_lead_last_touch) instead of per request: the two Overview statements and their drill-downs join on it.
-- Refresh order (refresh_all): ... mv_touch_flat, mv_lead_last_touch, mv_ic_decision, mv_lead_decision, mv_payer.

-- one row per non-blank interested course of a touched lead
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_ic_decision AS
WITH lm AS (
  SELECT x.lead_id, x.last_touch_at AS last_touch, m.lead_stage AS stage,
         COALESCE(ls.changed_at, GREATEST(m.created_at, '2026-03-01 00:00:00+00'::timestamptz)) AS lm_since
  FROM analytics.mv_lead_last_touch x
  JOIN analytics.mv_lead_lite m ON m.lead_id = x.lead_id
  LEFT JOIN salesforce.lead_stage ls ON ls.lead_id = x.lead_id AND ls.stage = m.lead_stage),
ic AS (
  SELECT ic.lead_master__c AS lead_id, ic.id AS ic_id, btrim(ic.status__c) AS status,
         COALESCE(h.changed_at, GREATEST(ic.createddate, '2026-03-01 00:00:00+00'::timestamptz)) AS ic_since
  FROM salesforce.interested_course__c ic
  LEFT JOIN salesforce.ic_status h ON h.ic_id = ic.id AND h.status = btrim(ic.status__c)
  WHERE ic.isdeleted = false AND NULLIF(btrim(ic.status__c), '') IS NOT NULL)
SELECT ic.lead_id, ic.ic_id, ic.status, ic.ic_since, lm.stage AS lead_stage, lm.lm_since, lm.last_touch,
       CASE WHEN lm.last_touch IS NULL THEN ic.status
            WHEN lm.lm_since > lm.last_touch AND lm.lm_since >= ic.ic_since THEN lm.stage        -- Lead Stage decided after the touch, later than this course's status
            WHEN ic.ic_since > lm.last_touch THEN ic.status                                       -- the course's status was decided after the touch
            WHEN ic.status IN ('Not Interested', 'May Buy Later') THEN 'New'                      -- parked course, touched again, nothing decided since
            ELSE ic.status END AS revised_key
FROM ic JOIN lm ON lm.lead_id = ic.lead_id
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_ic_decision_pk   ON analytics.mv_ic_decision (ic_id);
CREATE INDEX IF NOT EXISTS mv_ic_decision_lead        ON analytics.mv_ic_decision (lead_id);
CREATE INDEX IF NOT EXISTS mv_ic_decision_key         ON analytics.mv_ic_decision (revised_key);
ANALYZE analytics.mv_ic_decision;

-- one row per touched lead: its Lead Stage verdict (the latest IC decision is the course with the latest status moment)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_lead_decision AS
WITH lm AS (
  SELECT x.lead_id, x.last_touch_at AS last_touch, m.lead_stage AS stage,
         COALESCE(ls.changed_at, GREATEST(m.created_at, '2026-03-01 00:00:00+00'::timestamptz)) AS lm_since
  FROM analytics.mv_lead_last_touch x
  JOIN analytics.mv_lead_lite m ON m.lead_id = x.lead_id
  LEFT JOIN salesforce.lead_stage ls ON ls.lead_id = x.lead_id AND ls.stage = m.lead_stage),
i AS (
  SELECT DISTINCT ON (lead_id) lead_id, status AS ic_status, ic_since
  FROM analytics.mv_ic_decision ORDER BY lead_id, ic_since DESC)
SELECT lm.lead_id, lm.stage, lm.lm_since, lm.last_touch, i.ic_status, i.ic_since,
       CASE WHEN lm.stage = 'Converted' OR lm.last_touch IS NULL THEN lm.stage
            WHEN i.ic_since > lm.last_touch AND i.ic_since >= lm.lm_since THEN i.ic_status      -- a course status decided after the touch, later than the stage
            WHEN lm.lm_since > lm.last_touch THEN lm.stage                                        -- the stage was decided after the touch
            WHEN lm.stage IN ('Connected', 'Not Willing Now', 'Disqualified', 'Not Connected', 'P2 Completed') THEN 'New'   -- parked, touched again
            ELSE lm.stage END AS revised_key
FROM lm LEFT JOIN i ON i.lead_id = lm.lead_id
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_lead_decision_pk ON analytics.mv_lead_decision (lead_id);
CREATE INDEX IF NOT EXISTS mv_lead_decision_key       ON analytics.mv_lead_decision (revised_key);
ANALYZE analytics.mv_lead_decision;

CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE t0 timestamptz; n bigint; v text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN RAISE NOTICE 'refresh_all already running'; RETURN; END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY['analytics.mv_user_phone', 'analytics.mv_ujra_payment', 'analytics.mv_lead_lite', 'analytics.mv_touch_flat',
                             'analytics.mv_lead_last_touch', 'analytics.mv_ic_decision', 'analytics.mv_lead_decision', 'analytics.mv_payer'] LOOP
      t0 := clock_timestamp();
      n := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n; seconds := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all')); RAISE; END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;
