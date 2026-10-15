-- 034 (2026-10-15)  When did each Interested Course enter its current status?
-- Reduced by the sync from Interested_Course__History (Field = Status__c): one row per IC with the latest change.
-- Used by the Overview card "Revised Lead funnel · IC status": an IC in Not Interested / May Buy Later whose lead was
-- touched after this moment counts as New again. Without a row (change before 1 March 2026, when history starts) the
-- fallback is GREATEST(IC created, 2026-03-01), the same rule as salesforce.lead_stage.
CREATE TABLE IF NOT EXISTS salesforce.ic_status (
  ic_id       text PRIMARY KEY,
  lead_id     text,                    -- Lead_Master__c of the IC (filled from interested_course__c when known)
  status      text NOT NULL,           -- NewValue of the latest change
  prev_status text,                    -- OldValue of that change
  changed_at  timestamptz NOT NULL,    -- CreatedDate of that history row
  _synced_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ic_status_lead_idx    ON salesforce.ic_status (lead_id);
CREATE INDEX IF NOT EXISTS ic_status_changed_idx ON salesforce.ic_status (changed_at);
SELECT count(*) AS ic_status_rows FROM salesforce.ic_status;
