-- 038 (2026-10-23): the academic year of a batch comes from the app's syllabus structure (core_syllabusstructure.academic_year),
-- copied by the sync onto app.core_batch. analytics.academic_year() prefers it; the batch-title pattern and the payment date
-- remain fallbacks for batches whose course has no year.
ALTER TABLE app.core_batch ADD COLUMN IF NOT EXISTS academic_year text;

CREATE OR REPLACE FUNCTION analytics.academic_year(batch_academic_year text, batch_title text, payment_date date)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    NULLIF(btrim(batch_academic_year), ''),
    (SELECT m[1] || '-' || m[2] FROM regexp_matches(COALESCE(batch_title, ''), '(20[0-9]{2})\s*[-–]\s*([0-9]{2})') AS m LIMIT 1),
    CASE WHEN payment_date IS NULL THEN NULL
         WHEN EXTRACT(month FROM payment_date) >= 4 THEN EXTRACT(year FROM payment_date)::int::text || '-' || to_char((EXTRACT(year FROM payment_date)::int + 1) % 100, 'FM00')
         ELSE (EXTRACT(year FROM payment_date)::int - 1)::text || '-' || to_char(EXTRACT(year FROM payment_date)::int % 100, 'FM00') END)
$$;
DROP FUNCTION IF EXISTS analytics.academic_year(text, date);

SELECT analytics.academic_year('2026-27', 'Booster Crash-Class 8 English Medium (2025-26) Two Year-B1', '2026-02-10') AS prefers_structure,
       analytics.academic_year(NULL, 'Class 10 Foundation (2026-27)', '2026-02-10') AS title_fallback,
       analytics.academic_year(NULL, NULL, '2026-10-05') AS date_fallback;
