-- 046 (2026-10-31): the IST calendar days on which a lead had an activity (a Salesforce Task on the Lead Master or one of its
-- Interested Courses), kept per lead next to the call summary. Needed by the Overview's "First touch -> first activity" turnaround:
-- the first activity ON OR AFTER the lead's first touch inside the selected date range, which the first/last call timestamps alone
-- cannot answer. Filled by the sync (sync.ts syncCallSummary); existing rows need one full reload of Lead_Calls.
ALTER TABLE salesforce.lead_calls ADD COLUMN IF NOT EXISTS call_days date[];
