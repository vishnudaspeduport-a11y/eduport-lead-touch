-- =====================================================================
-- 018_class_groups.sql (2026-09-25)  Class filter groups, per the BI team's rules
--   Class 4 ... Class 12 : every medium / board variant of that class (SSLC -> Class 10, PLUS TWO -> Class 12, CBSE included)
--   CUET                 -> Class 12
--   *Repeater*           -> Repeater (JEE Repeater_26, NEET Repeater_26, Re-Repeater, ...)
--   KEAM/JEE Crash       -> its own group;  NEET Crash -> its own group;  NMMS -> its own group
--   Plus Two Completed, Unknown (blank), Other unchanged
-- class_group is stored in mv_touch_flat / mv_payer, so both are refreshed at the end.
-- =====================================================================
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
  IF n ~ '(^|\s)CUET(\s|$)' THEN RETURN 'Class 12'; END IF;

  IF n ~ '(^|\s)(PLUS ?TWO|PLUS ?2|CLASS ?12|12 ?TH|STD ?12|XII|HSE 2|SECOND YEAR)(\s|$)' THEN RETURN 'Class 12'; END IF;
  IF n ~ '(^|\s)(PLUS ?ONE|PLUS ?1|CLASS ?11|11 ?TH|STD ?11|XI|HSE 1|FIRST YEAR)(\s|$)'   THEN RETURN 'Class 11'; END IF;
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
    WHEN 'Class 8' THEN 8  WHEN 'Class 9' THEN 9  WHEN 'Class 10' THEN 10 WHEN 'Class 11' THEN 11
    WHEN 'Class 12' THEN 12 WHEN 'Plus Two Completed' THEN 13 WHEN 'Repeater' THEN 14
    WHEN 'KEAM/JEE Crash' THEN 15 WHEN 'NEET Crash' THEN 16 WHEN 'NMMS' THEN 17
    WHEN 'Other' THEN 98 WHEN 'Unknown' THEN 99 ELSE 97 END
$$;

SELECT raw, analytics.class_group(raw) AS grp FROM (VALUES ('SSLC ENGLISH'), ('CLASS - 9 CBSE'), ('Class 10 CBSE'), ('CUET'), ('CUET - Commerce'),
  ('JEE Repeater_26'), ('Re-Repeater NEET'), ('KEAM/JEE Crash'), ('NEET CRASH'), ('NMMS'), ('PLUS TWO SCIENCE CBSE'), ('Plus Two Completed on 2026'), (NULL)) v(raw);

SELECT * FROM analytics.refresh_all();
