-- =====================================================================
-- 023_alt_number.sql (2026-09-29)  Match payments to leads through the app account's ALTERNATIVE number as well
-- User decision: a payment counts for a lead when the lead's phone equals the paying account's own phone OR its
-- alternative_number (families that pay from a second account and give the lead's number as the alternative one).
-- The mother / father numbers are NOT used. Step 1: the column and its index; the views follow in 024.
-- =====================================================================
ALTER TABLE app.home_customuser ADD COLUMN IF NOT EXISTS alternative_number text;
@@
CREATE INDEX IF NOT EXISTS home_customuser_alt_phone_key ON app.home_customuser (analytics.phone_key(alternative_number)) WHERE is_deleted = false AND alternative_number IS NOT NULL;
