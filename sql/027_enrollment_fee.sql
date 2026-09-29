-- =====================================================================
-- 027_enrollment_fee.sql (2026-09-29)  Proposed fee of an enrollment for the Overview KPIs
-- Proposed fee = home_enrollment.fee - home_enrollment.discount (user definition); copied by the sync with every payment.
-- Fee received is summed from app.home_payment.amount, so it needs no new column.
-- =====================================================================
ALTER TABLE app.home_payment ADD COLUMN IF NOT EXISTS enrollment_fee numeric, ADD COLUMN IF NOT EXISTS enrollment_discount numeric;
