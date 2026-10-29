-- 042 (2026-10-29): Class 11 / Class 12 split by stream in the Class filter and the class cards.
--   Class 11 Science / Class 11 Commerce / Class 11 Humanities / Class 11 (no stream)
--   Class 12 Science / Class 12 Commerce / Class 12 Humanities / Class 12 (no stream)   (CUET -> Class 12 (no stream), CUET - Commerce -> Class 12 Commerce)
-- The stream is read from the lead's Class field ("PLUSONE SCIENCE", "PLUS TWO COMMERCE", "PLUSONE HUMANITIES", "PLUS TWO SCIENCE CBSE" ...);
-- "PLUSONE" / "PLUS TWO" alone = stream not recorded. Everything else is unchanged from sql/018.
-- class_group is stored in mv_lead_lite / mv_touch_flat / mv_payer: run analytics.refresh_all() afterwards.
CREATE OR REPLACE FUNCTION analytics.class_group(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n  text;
  m  text[];
  s  text;
  k_completed constant text := 'Plus Two Completed';
  k_unknown   constant text := 'Unknown';
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN k_unknown; END IF;
  n := btrim(regexp_replace(upper(p), '[^A-Z0-9]+', ' ', 'g'));
  IF n IN ('NOT UPDATED', 'NA', 'N A', 'NONE', 'NULL') THEN RETURN k_unknown; END IF;

  IF n ~ '(PLUS ?TWO|PLUS ?2|12(TH)?|XII) COMPLETED' OR n ~ '^COMPLETED' THEN RETURN k_completed; END IF;
  IF n ~ 'REPEATER' OR n ~ 'REPEAT(ER)?S?$' OR n ~ 'DROPPER' THEN RETURN 'Repeater'; END IF;

  -- named programmes kept as their own groups
  IF n ~ 'NMMS' THEN RETURN 'NMMS'; END IF;
  IF n ~ 'CRASH' THEN
    IF n ~ 'NEET' THEN RETURN 'NEET Crash'; END IF;
    RETURN 'KEAM/JEE Crash';
  END IF;

  -- stream of a Class 11 / 12 lead, from the same field
  s := CASE WHEN n ~ 'SCIENCE' THEN ' Science' WHEN n ~ 'COMMERCE' THEN ' Commerce' WHEN n ~ 'HUMANIT|(^|\s)ARTS(\s|$)' THEN ' Humanities' ELSE ' (no stream)' END;

  IF n ~ '(^|\s)CUET(\s|$)' THEN RETURN 'Class 12' || s; END IF;
  IF n ~ '(^|\s)(PLUS ?TWO|PLUS ?2|CLASS ?12|12 ?TH|STD ?12|XII|HSE 2|SECOND YEAR)(\s|$)' THEN RETURN 'Class 12' || s; END IF;
  IF n ~ '(^|\s)(PLUS ?ONE|PLUS ?1|CLASS ?11|11 ?TH|STD ?11|XI|HSE 1|FIRST YEAR)(\s|$)'   THEN RETURN 'Class 11' || s; END IF;
  IF n ~ '(^|\s)(SSLC|CLASS ?10|10 ?TH|STD ?10|X|TENTH)(\s|$)'                          THEN RETURN 'Class 10'; END IF;

  m := regexp_match(n, '(^|\s)(?:CLASS|STD|STANDARD|GRADE)?\s*([1-9])\s*(?:TH|ST|ND|RD)?(?:\s|$)');
  IF m IS NOT NULL THEN
    IF m[2]::int BETWEEN 4 AND 9 THEN RETURN 'Class ' || m[2]; END IF;
    RETURN 'Other';
  END IF;

  RETURN 'Other';
END $$;

CREATE OR REPLACE FUNCTION analytics.class_group_order(g text)
RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE g
    WHEN 'Class 4' THEN 4  WHEN 'Class 5' THEN 5  WHEN 'Class 6' THEN 6  WHEN 'Class 7' THEN 7
    WHEN 'Class 8' THEN 8  WHEN 'Class 9' THEN 9  WHEN 'Class 10' THEN 10
    WHEN 'Class 11 Science' THEN 11 WHEN 'Class 11 Commerce' THEN 12 WHEN 'Class 11 Humanities' THEN 13 WHEN 'Class 11 (no stream)' THEN 14
    WHEN 'Class 12 Science' THEN 15 WHEN 'Class 12 Commerce' THEN 16 WHEN 'Class 12 Humanities' THEN 17 WHEN 'Class 12 (no stream)' THEN 18
    WHEN 'Plus Two Completed' THEN 19 WHEN 'Repeater' THEN 20
    WHEN 'KEAM/JEE Crash' THEN 21 WHEN 'NEET Crash' THEN 22 WHEN 'NMMS' THEN 23
    WHEN 'Other' THEN 98 WHEN 'Unknown' THEN 99 ELSE 97 END
$$;

-- check
SELECT raw, analytics.class_group(raw) AS grp FROM (VALUES ('PLUSONE'), ('PLUSONE SCIENCE'), ('PLUSONE COMMERCE'), ('PLUSONE HUMANITIES'), ('PLUSONE SCIENCE CBSE'),
  ('PLUS TWO'), ('PLUS TWO SCIENCE'), ('PLUS TWO COMMERCE'), ('PLUS TWO HUMANITIES'), ('CUET'), ('CUET - Commerce'), ('Plus Two Completed on 2026'), ('SSLC ENGLISH'), ('NEET CRASH')) v(raw);
