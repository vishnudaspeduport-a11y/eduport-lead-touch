-- 037 (2026-10-23): academic year of a payment, for the Analysis page ("converted in which academic year").
-- Batch titles carry the year ("Class 10 Foundation (2026-27)", "Booster Crash-Class 8 English Medium (2025-26) Two Year-B1");
-- when a title has none (Ujra programmes, old batches) the payment date decides, with the year starting in April.
CREATE OR REPLACE FUNCTION analytics.academic_year(batch_title text, payment_date date)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    (SELECT m[1] || '-' || m[2] FROM regexp_matches(COALESCE(batch_title, ''), '(20[0-9]{2})\s*[-–]\s*([0-9]{2})') AS m LIMIT 1),
    CASE WHEN payment_date IS NULL THEN NULL
         WHEN EXTRACT(month FROM payment_date) >= 4 THEN EXTRACT(year FROM payment_date)::int::text || '-' || to_char((EXTRACT(year FROM payment_date)::int + 1) % 100, 'FM00')
         ELSE (EXTRACT(year FROM payment_date)::int - 1)::text || '-' || to_char(EXTRACT(year FROM payment_date)::int % 100, 'FM00') END)
$$;

SELECT analytics.academic_year('Class 10 Foundation (2026-27)', '2026-02-10') AS from_title,
       analytics.academic_year('Booster Crash-Class 8 English Medium (2025-26) Two Year-B1', '2026-02-10') AS from_title_2,
       analytics.academic_year('NEET - Integrated 27- 29', '2026-10-05') AS ujra_by_date,
       analytics.academic_year(NULL, '2026-02-10') AS feb_by_date,
       analytics.academic_year('USS Shakti B1', '2024-12-08') AS dec_by_date;
