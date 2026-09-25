-- =====================================================================
-- 019_lead_stage.sql (2026-09-25)  When did each lead enter its current stage?
-- Source: Salesforce field history (Lead_Master__History, Field = 'Lead_Stage__c'), reduced by the sync to ONE row per
-- lead = its latest stage change (~380k rows, ~25 MB). The full log (1.5 M rows since March 2026) is not stored.
-- Used by the Overview KPI "Re-touched after Not Willing Now / Disqualified / Not Connected / P2 Completed".
-- =====================================================================
CREATE TABLE IF NOT EXISTS salesforce.lead_stage (
  lead_id     text PRIMARY KEY,
  stage       text NOT NULL,           -- NewValue of the latest change
  prev_stage  text,                    -- OldValue of that change
  changed_at  timestamptz NOT NULL,    -- CreatedDate of that history row
  history_id  text,
  _synced_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_stage_changed_idx ON salesforce.lead_stage (changed_at);

-- Moment the lead entered its CURRENT stage: the latest history change into that stage; if none is known
-- (no change since the history window opened on 2026-03-01), the stage was set at creation or before the window.
CREATE OR REPLACE FUNCTION analytics.stage_since(p_lead_id text, p_stage text, p_created timestamptz)
RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    (SELECT s.changed_at FROM salesforce.lead_stage s WHERE s.lead_id = p_lead_id AND s.stage = p_stage),
    GREATEST(p_created, '2026-03-01 00:00:00+00'::timestamptz))
$$;

SELECT count(*) AS stage_rows FROM salesforce.lead_stage;
