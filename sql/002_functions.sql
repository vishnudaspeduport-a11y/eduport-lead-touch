-- =====================================================================
-- 002_functions.sql   (run as postgres in the Supabase SQL editor, after 001)
--
-- Every normalisation rule lives here and ONLY here.
-- =====================================================================
SET search_path = analytics, public;

-- ---------------------------------------------------------------------
-- phone_key: last 10 digits of any phone string, NULL when < 10 digits.
--   '91-98xxxxxxxx' -> '98xxxxxxxx' ;  '98xxxxxxxx' -> '98xxxxxxxx'
-- Used on BOTH sides of every phone join and in expression indexes,
-- so it must stay IMMUTABLE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.phone_key(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT CASE WHEN length(d) >= 10 THEN right(d, 10) END
  FROM (SELECT regexp_replace(p, '\D', '', 'g') AS d) s
$$;

-- Indian mobile sanity check (6-9 followed by 9 digits). Used by data quality only.
CREATE OR REPLACE FUNCTION analytics.phone_key_valid(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT analytics.phone_key(p) ~ '^[6-9][0-9]{9}$'
$$;

-- IST calendar date of a UTC timestamp (Salesforce stores UTC; payment_date is an IST calendar date)
CREATE OR REPLACE FUNCTION analytics.ist_date(ts timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (ts AT TIME ZONE 'Asia/Kolkata')::date
$$;

-- ---------------------------------------------------------------------
-- class_group: dirty Class__c  ->  'Class 4' ... 'Class 12', 'Repeater',
--              'Plus Two Completed', 'Unknown', 'Other'
--
-- Observed raw values (2026-09-19): 'PLUS TWO SCIENCE', 'PLUSONE', 'SSLC MALAYALAM',
-- 'CLASS - 9 ENGLISH', 'Class 10 CBSE', 'Plus Two Completed on 2026', 'Repeater',
-- 'NEET Repeater_26', 'Re-Repeater NEET', 'CUET', 'KEAM/JEE Crash', 'Not updated', NULL
--
-- DEVIATIONS from the brief (flagged, see README "Deviations"):
--   * 'Plus Two Completed' is its own group (it is the single largest bucket,
--     ~400k leads; folding it into 'Other' would hide it).
--   * NULL / blank / 'Not updated' -> 'Unknown' (kept apart from 'Other' so
--     data-quality can count it). Set the two constants below to 'Other' to
--     collapse them back to the brief's 12-bucket scheme.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.class_group(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n  text;
  m  text[];
  k_completed constant text := 'Plus Two Completed';
  k_unknown   constant text := 'Unknown';
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN k_unknown; END IF;
  -- case- and separator-insensitive: upper-case, every non-alnum run -> one space
  n := btrim(regexp_replace(upper(p), '[^A-Z0-9]+', ' ', 'g'));
  IF n IN ('NOT UPDATED', 'NA', 'N A', 'NONE', 'NULL') THEN RETURN k_unknown; END IF;

  IF n ~ '(PLUS ?TWO|PLUS ?2|12(TH)?|XII) COMPLETED' OR n ~ '^COMPLETED' THEN RETURN k_completed; END IF;
  IF n ~ 'REPEATER' OR n ~ 'REPEAT(ER)?S?$' OR n ~ 'DROPPER' THEN RETURN 'Repeater'; END IF;

  IF n ~ '(^|\s)(PLUS ?TWO|PLUS ?2|CLASS ?12|12 ?TH|STD ?12|XII|HSE 2|SECOND YEAR)(\s|$)' THEN RETURN 'Class 12'; END IF;
  IF n ~ '(^|\s)(PLUS ?ONE|PLUS ?1|CLASS ?11|11 ?TH|STD ?11|XI|HSE 1|FIRST YEAR)(\s|$)'   THEN RETURN 'Class 11'; END IF;
  IF n ~ '(^|\s)(SSLC|CLASS ?10|10 ?TH|STD ?10|X|TENTH)(\s|$)'                          THEN RETURN 'Class 10'; END IF;

  -- "CLASS 9", "9TH", "STD 9", "GRADE 9", "9" (with any suffix such as MALAYALAM/CBSE)
  m := regexp_match(n, '(^|\s)(?:CLASS|STD|STANDARD|GRADE)?\s*([1-9])\s*(?:TH|ST|ND|RD)?(?:\s|$)');
  IF m IS NOT NULL THEN
    IF m[2]::int BETWEEN 4 AND 9 THEN RETURN 'Class ' || m[2]; END IF;
    RETURN 'Other';                                   -- Class 1-3: outside the brief's range
  END IF;

  RETURN 'Other';                                     -- CUET, Crash courses, NMMS, ...
END $$;

-- Sort key so charts can order class groups sensibly
CREATE OR REPLACE FUNCTION analytics.class_group_order(g text)
RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE g
    WHEN 'Class 4' THEN 4  WHEN 'Class 5' THEN 5  WHEN 'Class 6' THEN 6  WHEN 'Class 7' THEN 7
    WHEN 'Class 8' THEN 8  WHEN 'Class 9' THEN 9  WHEN 'Class 10' THEN 10 WHEN 'Class 11' THEN 11
    WHEN 'Class 12' THEN 12 WHEN 'Plus Two Completed' THEN 13 WHEN 'Repeater' THEN 14
    WHEN 'Other' THEN 98 ELSE 99 END
$$;

-- ---------------------------------------------------------------------
-- Paid vs organic (APP-ADDED heuristic - not in the Tableau workbook).
-- Lead-level: paid if the lead came from an ad source or carries a click id.
-- Touch-level: paid if the touch point is an ad / paid blast or the
--              source is a Meta placement code (ig / fb / an / meta) or medium says paid.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.is_paid_lead(
  lead_source text, gclid text, fbclid text, meta_lead_id text, ad_platform text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(lead_source IN ('Fb Ad','Marketing Lead','Third Paid Party','Advertisement',
                                  'Cbse 10 Marketing Lead','Google Ad','Meta Ad'), false)
      OR NULLIF(btrim(gclid),'')        IS NOT NULL
      OR NULLIF(btrim(fbclid),'')       IS NOT NULL
      OR NULLIF(btrim(meta_lead_id),'') IS NOT NULL
      OR NULLIF(btrim(ad_platform),'')  IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION analytics.is_paid_touch(touch_point text, source text, medium text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(touch_point IN ('Meta Ad','Google Ad','Paid Landing Page','WhatsApp Paid Blast'), false)
      OR lower(COALESCE(source,'')) IN ('ig','fb','an','meta','msg','paid')
      OR lower(COALESCE(medium,'')) ~ '^(paid|cpc|ppc|paid_social|paidsocial|cpm)$'
$$;

-- Touch-count bucket used by the touch curve and KPI distribution
CREATE OR REPLACE FUNCTION analytics.touch_bucket(n int)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN n IS NULL OR n <= 0 THEN '0' WHEN n >= 6 THEN '6+' ELSE n::text END
$$;

-- Gap bucket (hours between consecutive touches)
CREATE OR REPLACE FUNCTION analytics.gap_bucket(hours numeric)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN hours IS NULL THEN NULL
    WHEN hours < 1    THEN '< 1h'
    WHEN hours < 24   THEN '1-24h'
    WHEN hours < 72   THEN '1-3d'
    WHEN hours < 168  THEN '3-7d'
    WHEN hours < 720  THEN '7-30d'
    ELSE '30d+' END
$$;

-- Indian financial year start (Apr 1) - used by the FY presets and cohort labels
CREATE OR REPLACE FUNCTION analytics.fy_start(d date)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT make_date(CASE WHEN extract(month FROM d) >= 4 THEN extract(year FROM d)::int ELSE extract(year FROM d)::int - 1 END, 4, 1)
$$;

-- ---------------------------------------------------------------------
-- Self-test for class_group (run: SELECT * FROM analytics.class_group_selftest();)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.class_group_selftest()
RETURNS TABLE(raw text, expected text, got text, ok boolean)
LANGUAGE sql STABLE AS $$
  SELECT raw, expected, analytics.class_group(raw), analytics.class_group(raw) = expected
  FROM (VALUES
    ('CLASS - 4','Class 4'), ('Class 4','Class 4'), ('class-4','Class 4'), ('4th std','Class 4'),
    ('CLASS - 9 MALAYALAM','Class 9'), ('CLASS - 8 CBSE','Class 8'),
    ('SSLC MALAYALAM','Class 10'), ('Class 10 CBSE','Class 10'),
    ('PLUSONE','Class 11'), ('PLUSONE SCIENCE CBSE','Class 11'), ('Plus One Commerce','Class 11'),
    ('PLUS TWO','Class 12'), ('PLUS TWO HUMANITIES','Class 12'), ('plus-two science','Class 12'),
    ('Plus Two Completed','Plus Two Completed'), ('Plus Two Completed (Science) on 2026','Plus Two Completed'),
    ('Repeater','Repeater'), ('NEET Repeater_26','Repeater'), ('Re-Repeater NEET','Repeater'), ('Repeater JEE (Online)','Repeater'),
    ('CUET','Other'), ('KEAM/JEE Crash','Other'), ('NMMS','Other'), ('CLASS - 2','Other'),
    (NULL,'Unknown'), ('','Unknown'), ('Not updated','Unknown')
  ) v(raw, expected)
$$;
