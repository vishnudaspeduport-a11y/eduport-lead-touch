-- =====================================================================
-- 020_lead_calls.sql (2026-09-25)  Call activity, one row per lead
-- Source: Salesforce Task (call log, 2 M rows since March 2026 - too big for the free tier). The sync reduces it to
-- one row per lead: how many calls, first / last call, and the reason + status + owner recorded on the LAST call.
-- Kept only for leads that have touches (the Overview's population); cleanup drops the rest.
-- =====================================================================
CREATE TABLE IF NOT EXISTS salesforce.lead_calls (
  lead_id           text PRIMARY KEY,
  calls             int NOT NULL DEFAULT 0,
  first_call_at     timestamptz,
  last_call_at      timestamptz,
  last_reason       text,
  last_call_status  text,
  last_owner_id     text,
  last_subject      text,
  _synced_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_calls_last_reason_idx ON salesforce.lead_calls (last_reason);
CREATE INDEX IF NOT EXISTS lead_calls_last_call_idx ON salesforce.lead_calls (last_call_at);

SELECT count(*) AS call_rows FROM salesforce.lead_calls;
