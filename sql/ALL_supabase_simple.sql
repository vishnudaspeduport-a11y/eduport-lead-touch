-- =====================================================================
-- ALL-IN-ONE (simple) for the Supabase SQL editor - no extra roles, no passwords.
-- Everything runs and is owned by the default postgres login.
-- Paste the whole file into SQL Editor -> New query -> Run. Nothing to edit.
-- =====================================================================


-- ############################ 001_schema_roles ############################
-- =====================================================================
-- 001_schema_roles.sql   (Supabase: paste into SQL Editor as the default
--                         "postgres" user, or run with psql. Run ONCE.)
--
-- Creates:
--   * role   lt_analytics_owner  - read/write on the replica tables, used by the sync job
--   * role   lt_app_ro           - read-only role used by the Cloudflare Worker (Hyperdrive)
--   * schema salesforce          - replica of the Salesforce objects   (fed by /sync)
--   * schema app                 - replica of the production app tables (fed by /sync)
--   * schema analytics           - functions, views, materialized views
--
-- Supabase notes
--   - Only the `public` and `graphql_public` schemas are exposed through the
--     Supabase REST/GraphQL API. Everything here lives in other schemas AND is
--     revoked from anon/authenticated, so the anon key can never read lead data.
--   - CHANGE the two passwords below before running (or ALTER ROLE afterwards).
-- =====================================================================



-- Objects stay owned by the user running this file (postgres in Supabase);
-- the two service roles only get the privileges they need.
CREATE SCHEMA IF NOT EXISTS salesforce;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS analytics;


-- Belt and braces: never expose these schemas to the Supabase API roles

-- ---------------------------------------------------------------------
-- Salesforce replica tables
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS salesforce.lead_master__c (
  id                              varchar(18) PRIMARY KEY,
  name                            text,
  createddate                     timestamptz,
  lastmodifieddate                timestamptz,
  systemmodstamp                  timestamptz,
  isdeleted                       boolean NOT NULL DEFAULT false,
  ownerid                         varchar(18),
  first_name__c                   text,
  last_name__c                    text,
  mobile_number__c                text,
  email__c                        text,
  class__c                        text,
  lead_source__c                  text,
  lead_source_detail__c           text,
  lead_stage__c                   text,
  lead_type__c                    text,
  priority__c                     text,
  district__c                     text,
  city__c                         text,
  state__c                        text,
  campaign_name__c                text,
  campaign_quality__c             text,
  campaign_tag__c                 text,
  campaign_date__c                date,
  ad_platform__c                  text,
  ad_campaign__c                  text,
  ad_set__c                       text,
  ad_name__c                      text,
  ad_class__c                     text,
  ad_class_match__c               text,
  enquiry_assigned_date__c        date,
  follow_up_date__c               date,
  next_followup_due__c            date,
  touch_count__c                  double precision,
  first_touch_date__c             timestamptz,
  first_touch_point__c            text,
  last_touch_date__c              timestamptz,
  last_touch_point__c             text,
  is_converted__c                 boolean,
  converted_date__c               timestamptz,
  converted_after_first_touch__c  boolean,
  customer_before_first_touch__c  boolean,
  days_to_convert__c              double precision,
  ic_count__c                     double precision,
  ic_enrolled_count__c            double precision,
  best_ic_status__c               text,
  ic_course__c                    text,
  enrollment_count__c             double precision,
  enrolled_value__c               numeric(18,2),
  app_engagement_tier__c          text,
  app_time_30d_min__c             double precision,
  app_active_days_30d__c          double precision,
  app_last_active__c              timestamptz,
  is_deleted__c                   boolean NOT NULL DEFAULT false,
  is_duplicate__c                 boolean NOT NULL DEFAULT false,
  parent_lead_master__c           varchar(18),
  lm_reason__c                    text,
  hot_lead__c                     date,
  supreme_hot__c                  date,
  relogged_in__c                  date,
  gclid__c                        text,
  fbclid__c                       text,
  meta_lead_id__c                 text,
  _synced_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salesforce.lead_touch__c (
  id                        varchar(18) PRIMARY KEY,
  name                      text,
  createddate               timestamptz,
  systemmodstamp            timestamptz,
  isdeleted                 boolean NOT NULL DEFAULT false,
  lead_master__c            varchar(18),
  touch_date__c             timestamptz,
  touch_point__c            text,
  source__c                 text,
  medium__c                 text,
  campaign__c               text,
  adset_name__c             text,
  ad_name__c                text,
  platform_id__c            text,
  staff__c                  text,
  is_first_touch__c         boolean,
  is_last_touch__c          boolean,
  is_first_of_type__c       boolean,
  is_converted__c           boolean,
  converted_date__c         timestamptz,
  lead_converted__c         boolean,
  lead_converted_date__c    timestamptz,
  was_customer_at_touch__c  boolean,
  attribution_credit__c     double precision,
  credit_value__c           numeric(18,2),
  ic_status__c              text,
  ic_course__c              text,
  ic_name__c                text,
  multiple_ics__c           boolean,
  _synced_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salesforce.interested_course__c (
  id                        varchar(18) PRIMARY KEY,
  name                      text,
  createddate               timestamptz,
  systemmodstamp            timestamptz,
  isdeleted                 boolean NOT NULL DEFAULT false,
  lead_master__c            varchar(18),
  course__c                 varchar(18),
  course_name__c            text,
  status__c                 text,
  is_enrolled__c            boolean,
  fees_offered__c           numeric(18,2),
  assigned_date__c          date,
  target_customer__c        text,
  ad_campaign__c            text,
  occupation_categories__c  text,
  ownerid                   varchar(18),
  _synced_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salesforce.task (
  id                           varchar(18) PRIMARY KEY,
  whatid                       varchar(18),
  mobile_number__c             text,
  subject                      text,
  type                         text,
  status                       text,
  activitydate                 date,
  calldurationinseconds        integer,
  call_status__c               text,
  call_start_time__c           timestamptz,
  reason__c                    text,
  interested_course_status__c  text,
  ownerid                      varchar(18),
  isdeleted                    boolean NOT NULL DEFAULT false,
  createddate                  timestamptz,
  systemmodstamp               timestamptz,
  _synced_at                   timestamptz NOT NULL DEFAULT now()
);

-- Owner / staff names (OwnerId -> User.Name)
CREATE TABLE IF NOT EXISTS salesforce."user" (
  id              varchar(18) PRIMARY KEY,
  name            text,
  email           text,
  isactive        boolean,
  userrole_name   text,
  profile_name    text,
  systemmodstamp  timestamptz,
  _synced_at      timestamptz NOT NULL DEFAULT now()
);

-- Course names for Interested_Course__c.Course__c
CREATE TABLE IF NOT EXISTS salesforce.course__c (
  id              varchar(18) PRIMARY KEY,
  name            text,
  isdeleted       boolean NOT NULL DEFAULT false,
  systemmodstamp  timestamptz,
  _synced_at      timestamptz NOT NULL DEFAULT now()
);

-- Incremental-sync watermarks (one row per source object / table)
CREATE TABLE IF NOT EXISTS salesforce._sync_state (
  object_name      text PRIMARY KEY,
  last_modstamp    timestamptz,
  last_run_at      timestamptz,
  last_run_rows    integer,
  last_error       text
);

-- ---------------------------------------------------------------------
-- Production app tables, replicated by sync/ from the Eduport production
-- Postgres (only the columns the analytics need - no passwords, no PII
-- beyond phone, which the phone-key join requires).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.home_customuser (
  id            integer PRIMARY KEY,
  phone         text,
  name          text,
  is_deleted    boolean NOT NULL DEFAULT false,
  is_premium    boolean,
  premium_date  date,
  district      text,
  city          text,
  created       timestamptz,
  last_active   timestamptz,
  updated_at    timestamptz,
  _synced_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.home_payment (
  id               integer PRIMARY KEY,
  user_id          integer,
  payment_method   integer,
  payment_type     integer,
  deleted          boolean NOT NULL DEFAULT false,
  is_success       boolean,
  payment_success  boolean,
  payment_date     date,
  payment_time     timestamptz,
  created          timestamptz,
  amount           numeric(18,2),
  total            numeric(18,2),
  tuition_fees     numeric(18,2),
  discount         numeric(18,2),
  refund_amount    numeric(18,2),
  course_id        integer,
  course_new_id    bigint,
  batch_id         bigint,
  sales_person_id  integer,
  enrollment_id    integer,
  _synced_at       timestamptz NOT NULL DEFAULT now()
);



-- ############################ 002_functions ############################
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


-- ############################ 003_views ############################
-- =====================================================================
-- 003_views.sql   (run as postgres in the Supabase SQL editor, after 002)
--
-- Layering (each layer only reads the one above it):
--   v_valid_payment   valid payments + normalised phone key
--   v_lead_payment    per-lead conversion (earliest valid payment, revenue)
--   v_lead_conv       one row per lead (Lead_Master__c grain) + conversion columns
--   v_touch_base      one row per valid touch + lead attributes + attribution credits
--   v_lead_base       v_lead_conv + touch aggregates (first/last touch, counts)
--
-- Authority order: Lead_Master__c is the grain for anything "per lead".
-- Lead_Touch__c is only joined for touch/attribution questions.
-- Leads are never counted from Lead_Touch__c.
--
-- Time zone: Salesforce datetimes are UTC. All calendar dates are IST
-- (analytics.ist_date) so that they line up with home_payment.payment_date.
-- =====================================================================
SET search_path = analytics, public;

-- ---------------------------------------------------------------------
-- Valid payment (exact port of the Tableau definition)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_valid_payment AS
SELECT
  p.id                              AS payment_id,
  p.user_id,
  analytics.phone_key(u.phone)      AS phone_key,
  p.payment_date,
  p.payment_time,
  p.created                         AS payment_created,
  p.total,
  p.amount,
  p.tuition_fees,
  p.discount,
  p.refund_amount,
  p.course_id,
  p.course_new_id,
  p.batch_id,
  p.sales_person_id,
  p.enrollment_id,
  p.payment_type
FROM app.home_payment p
JOIN app.home_customuser u ON u.id = p.user_id
WHERE p.payment_method  = 0
  AND p.deleted         = false
  AND p.is_success      = true
  AND p.payment_success = true
  AND u.is_deleted      = false
  AND p.payment_date IS NOT NULL;

-- ---------------------------------------------------------------------
-- Per-lead conversion. A lead is converted when ANY valid payment matches
-- on the normalised phone. converted_at = earliest valid payment_date.
-- (Pre-existing customers - payment before the lead was created - are still
--  "converted" per the workbook; v_lead_conv.pre_existing_customer flags them.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lead_payment AS
SELECT
  l.id                            AS lead_id,
  MIN(vp.payment_date)            AS converted_at,
  MIN(vp.payment_time)            AS first_payment_time,
  COUNT(*)                        AS payment_count,
  SUM(vp.total)                   AS revenue,
  SUM(COALESCE(vp.refund_amount,0)) AS refunds,
  MIN(vp.user_id)                 AS app_user_id
FROM salesforce.lead_master__c l
JOIN analytics.v_valid_payment vp
  ON vp.phone_key = analytics.phone_key(l.mobile_number__c)
GROUP BY l.id;

-- ---------------------------------------------------------------------
-- One row per lead (no touch data yet)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lead_conv AS
SELECT
  l.id                                   AS lead_id,
  l.name                                 AS lead_name,
  l.createddate                          AS created_at,
  analytics.ist_date(l.createddate)      AS created_date,
  l.first_name__c                        AS first_name,
  l.last_name__c                         AS last_name,
  l.mobile_number__c                     AS mobile,
  l.email__c                             AS email,
  analytics.phone_key(l.mobile_number__c) AS phone_key,
  analytics.phone_key_valid(l.mobile_number__c) AS phone_valid,
  l.class__c                             AS class_raw,
  analytics.class_group(l.class__c)      AS class_group,
  COALESCE(NULLIF(btrim(l.lead_source__c),''), '(blank)') AS lead_source,
  l.lead_source_detail__c                AS lead_source_detail,
  COALESCE(NULLIF(btrim(l.lead_stage__c),''), '(blank)')  AS lead_stage,
  l.lead_type__c                         AS lead_type,
  l.priority__c                          AS priority,
  l.district__c                          AS district,
  l.city__c                              AS city,
  l.state__c                             AS state,
  l.campaign_name__c                     AS campaign_name,
  l.campaign_quality__c                  AS campaign_quality,
  l.campaign_tag__c                      AS campaign_tag,
  l.campaign_date__c                     AS campaign_date,
  l.ad_platform__c                       AS ad_platform,
  l.ad_campaign__c                       AS ad_campaign,
  l.ad_set__c                            AS ad_set,
  l.ad_name__c                           AS ad_name,
  l.ad_class__c                          AS ad_class,
  l.ad_class_match__c                    AS ad_class_match,
  l.ownerid                              AS owner_id,
  COALESCE(u.name, l.ownerid)            AS owner_name,
  l.enquiry_assigned_date__c             AS enquiry_assigned_date,
  l.follow_up_date__c                    AS follow_up_date,
  l.next_followup_due__c                 AS next_followup_due,
  l.touch_count__c                       AS sf_touch_count,
  l.first_touch_date__c                  AS sf_first_touch_at,
  l.first_touch_point__c                 AS sf_first_touch_point,
  l.last_touch_date__c                   AS sf_last_touch_at,
  l.last_touch_point__c                  AS sf_last_touch_point,
  COALESCE(l.is_converted__c,false)      AS sf_is_converted,
  l.converted_date__c                    AS sf_converted_at,
  l.converted_after_first_touch__c       AS sf_converted_after_first_touch,
  l.customer_before_first_touch__c       AS sf_customer_before_first_touch,
  l.ic_count__c                          AS ic_count,
  l.ic_enrolled_count__c                 AS ic_enrolled_count,
  l.best_ic_status__c                    AS best_ic_status,
  l.ic_course__c                         AS ic_course,
  l.enrollment_count__c                  AS enrollment_count,
  l.enrolled_value__c                    AS sf_enrolled_value,
  l.app_engagement_tier__c               AS app_engagement_tier,
  l.app_time_30d_min__c                  AS app_time_30d_min,
  l.app_active_days_30d__c               AS app_active_days_30d,
  l.app_last_active__c                   AS app_last_active,
  COALESCE(l.is_duplicate__c,false)      AS is_duplicate,
  l.parent_lead_master__c                AS parent_lead_id,
  l.lm_reason__c                         AS lm_reason,
  l.hot_lead__c                          AS hot_lead_date,
  l.supreme_hot__c                       AS supreme_hot_date,
  l.relogged_in__c                       AS relogged_in_date,
  (l.hot_lead__c IS NOT NULL)            AS is_hot,
  (l.supreme_hot__c IS NOT NULL)         AS is_supreme_hot,
  (l.relogged_in__c IS NOT NULL)         AS is_relogged,
  (l.parent_lead_master__c IS NOT NULL)  AS is_repeat,
  analytics.is_paid_lead(l.lead_source__c, l.gclid__c, l.fbclid__c, l.meta_lead_id__c, l.ad_platform__c) AS is_paid_lead,
  (l.gclid__c IS NOT NULL OR l.fbclid__c IS NOT NULL OR l.meta_lead_id__c IS NOT NULL) AS has_click_id,
  -- conversion (from payments)
  (p.lead_id IS NOT NULL)                AS converted,
  p.converted_at,
  p.first_payment_time,
  COALESCE(p.payment_count,0)            AS payment_count,
  COALESCE(p.revenue,0)                  AS revenue,
  COALESCE(p.refunds,0)                  AS refunds,
  p.app_user_id,
  (p.converted_at - analytics.ist_date(l.createddate))::int AS days_to_convert,
  (p.converted_at < analytics.ist_date(l.createddate))      AS pre_existing_customer
FROM salesforce.lead_master__c l
LEFT JOIN salesforce."user" u   ON u.id = l.ownerid
LEFT JOIN analytics.v_lead_payment p ON p.lead_id = l.id
WHERE COALESCE(l.is_deleted__c,false) = false
  AND COALESCE(l.isdeleted,false)     = false;

-- ---------------------------------------------------------------------
-- One row per valid touch (IsDeleted = false, lead exists and not deleted)
-- with sequence numbers and attribution credits.
--
-- is_pre_conversion: touch_date (IST) <= converted_at, or lead not converted.
--   Post-payment touches are kept in the view (for "total touches" and the
--   timeline) but carry NO attribution credit and no touch_seq.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_touch_base AS
WITH tv AS (
  SELECT
    t.id                                AS touch_id,
    t.lead_master__c                    AS lead_id,
    t.touch_date__c                     AS touch_at,
    analytics.ist_date(t.touch_date__c) AS touch_date,
    COALESCE(NULLIF(btrim(t.touch_point__c),''), '(blank)') AS touch_point,
    COALESCE(NULLIF(btrim(t.source__c),''),      '(blank)') AS source,
    COALESCE(NULLIF(btrim(t.medium__c),''),      '(blank)') AS medium,
    COALESCE(NULLIF(btrim(t.campaign__c),''),    '(blank)') AS campaign,
    t.adset_name__c                     AS adset_name,
    t.ad_name__c                        AS ad_name,
    t.platform_id__c                    AS platform_id,
    NULLIF(btrim(t.staff__c),'')        AS staff,
    t.is_first_touch__c                 AS sf_is_first_touch,
    t.is_last_touch__c                  AS sf_is_last_touch,
    t.is_first_of_type__c               AS sf_is_first_of_type,
    COALESCE(t.is_converted__c,false)   AS sf_is_converted,
    t.converted_date__c                 AS sf_converted_at,
    COALESCE(t.was_customer_at_touch__c,false) AS sf_was_customer_at_touch,
    t.attribution_credit__c             AS sf_attribution_credit,
    t.credit_value__c                   AS sf_credit_value,
    t.ic_status__c                      AS ic_status,
    t.ic_course__c                      AS touch_ic_course,
    t.multiple_ics__c                   AS multiple_ics,
    t.createddate                       AS touch_created_at,
    analytics.is_paid_touch(t.touch_point__c, t.source__c, t.medium__c) AS is_paid_touch,
    c.created_at                        AS lead_created_at,
    c.created_date                      AS lead_created_date,
    c.lead_source, c.class_group, c.lead_stage, c.lead_type, c.priority,
    c.district, c.city, c.owner_id, c.owner_name, c.campaign_quality,
    c.app_engagement_tier, c.ic_course, c.best_ic_status, c.is_duplicate, c.is_paid_lead,
    c.converted, c.converted_at, c.revenue, c.pre_existing_customer,
    (c.converted_at IS NULL OR analytics.ist_date(t.touch_date__c) <= c.converted_at) AS is_pre_conversion
  FROM salesforce.lead_touch__c t
  JOIN analytics.v_lead_conv c ON c.lead_id = t.lead_master__c
  WHERE COALESCE(t.isdeleted,false) = false
    AND t.touch_date__c IS NOT NULL
),
seq AS (
  SELECT tv.*,
    row_number() OVER w_all                                   AS touch_seq_all,
    count(*)     OVER (PARTITION BY lead_id)                  AS n_touches_all,
    lag(touch_at) OVER w_all                                  AS prev_touch_at,
    CASE WHEN is_pre_conversion THEN
      row_number() OVER (PARTITION BY lead_id, is_pre_conversion ORDER BY touch_at, touch_id) END AS touch_seq,
    CASE WHEN is_pre_conversion THEN
      count(*) OVER (PARTITION BY lead_id, is_pre_conversion) END AS n_pre_touches
  FROM tv
  WINDOW w_all AS (PARTITION BY lead_id ORDER BY touch_at, touch_id)
)
SELECT s.*,
  (s.touch_seq = 1)                                         AS is_first_touch,
  (s.touch_seq = s.n_pre_touches)                           AS is_last_touch,
  round((EXTRACT(epoch FROM s.touch_at - s.prev_touch_at) / 3600)::numeric, 2) AS gap_hours_from_prev,
  analytics.gap_bucket((EXTRACT(epoch FROM s.touch_at - s.prev_touch_at) / 3600)::numeric) AS gap_bucket,
  EXTRACT(dow  FROM s.touch_at AT TIME ZONE 'Asia/Kolkata')::int AS touch_dow,
  EXTRACT(hour FROM s.touch_at AT TIME ZONE 'Asia/Kolkata')::int AS touch_hour,
  -- attribution credits (only converted leads, only pre-conversion touches)
  CASE WHEN s.converted AND s.is_pre_conversion AND s.touch_seq = 1               THEN 1.0 ELSE 0 END::numeric(8,5) AS credit_first,
  CASE WHEN s.converted AND s.is_pre_conversion AND s.touch_seq = s.n_pre_touches THEN 1.0 ELSE 0 END::numeric(8,5) AS credit_last,
  CASE WHEN s.converted AND s.is_pre_conversion THEN 1.0 / s.n_pre_touches ELSE 0 END::numeric(8,5)       AS credit_linear,
  CASE WHEN s.converted AND s.is_pre_conversion THEN
         CASE WHEN s.n_pre_touches = 1 THEN 1.0
              WHEN s.n_pre_touches = 2 THEN 0.5
              WHEN s.touch_seq = 1 OR s.touch_seq = s.n_pre_touches THEN 0.4
              ELSE 0.2 / (s.n_pre_touches - 2) END
       ELSE 0 END::numeric(8,5)                                                                          AS credit_position
FROM seq s;

-- ---------------------------------------------------------------------
-- One row per lead, enriched with touch aggregates
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lead_base AS
WITH ta AS (
  SELECT
    lead_id,
    count(*)                                              AS total_touches,
    count(*) FILTER (WHERE is_pre_conversion)             AS valid_touches,
    count(*) FILTER (WHERE is_paid_touch)                 AS paid_touches,
    count(DISTINCT touch_point)                           AS distinct_touch_points,
    count(DISTINCT staff) FILTER (WHERE staff IS NOT NULL) AS distinct_staff,
    min(touch_at)                                         AS first_touch_at,
    max(touch_at) FILTER (WHERE is_pre_conversion)        AS last_touch_at,
    max(touch_at)                                         AS last_touch_any_at,
    max(touch_point) FILTER (WHERE touch_seq_all = 1)     AS first_touch_point,
    max(source)      FILTER (WHERE touch_seq_all = 1)     AS first_touch_source,
    max(medium)      FILTER (WHERE touch_seq_all = 1)     AS first_touch_medium,
    max(campaign)    FILTER (WHERE touch_seq_all = 1)     AS first_touch_campaign,
    max(staff)       FILTER (WHERE touch_seq_all = 1)     AS first_touch_staff,
    max(touch_point) FILTER (WHERE is_last_touch)         AS last_touch_point,
    max(source)      FILTER (WHERE is_last_touch)         AS last_touch_source,
    max(medium)      FILTER (WHERE is_last_touch)         AS last_touch_medium,
    max(campaign)    FILTER (WHERE is_last_touch)         AS last_touch_campaign,
    max(staff)       FILTER (WHERE is_last_touch)         AS last_touch_staff,
    max(touch_point) FILTER (WHERE touch_seq_all = n_touches_all) AS last_touch_any_point,
    avg(gap_hours_from_prev) FILTER (WHERE is_pre_conversion)     AS avg_gap_hours
  FROM analytics.v_touch_base
  GROUP BY lead_id
)
SELECT
  c.*,
  COALESCE(ta.total_touches,0)::int      AS total_touches,
  COALESCE(ta.valid_touches,0)::int      AS valid_touches,
  COALESCE(ta.paid_touches,0)::int       AS paid_touches,
  COALESCE(ta.distinct_touch_points,0)::int AS distinct_touch_points,
  COALESCE(ta.distinct_staff,0)::int     AS distinct_staff,
  analytics.touch_bucket(COALESCE(ta.valid_touches,0)::int) AS touch_bucket,
  ta.first_touch_at,
  analytics.ist_date(ta.first_touch_at)  AS first_touch_date,
  ta.first_touch_point, ta.first_touch_source, ta.first_touch_medium, ta.first_touch_campaign, ta.first_touch_staff,
  ta.last_touch_at,
  analytics.ist_date(ta.last_touch_at)   AS last_touch_date,
  ta.last_touch_point, ta.last_touch_source, ta.last_touch_medium, ta.last_touch_campaign, ta.last_touch_staff,
  ta.last_touch_any_at, ta.last_touch_any_point,
  ta.avg_gap_hours,
  (COALESCE(ta.valid_touches,0) > 0)     AS attributable,          -- has >= 1 touch on/before payment
  (c.converted AND COALESCE(ta.valid_touches,0) > 0) AS first_touch_conversion,
  (c.converted AND COALESCE(ta.valid_touches,0) > 0) AS last_touch_conversion,
  (c.converted AND COALESCE(ta.valid_touches,0) = 0) AS unattributed_conversion,
  round((EXTRACT(epoch FROM ta.first_touch_at - c.created_at) / 3600)::numeric, 2) AS response_hours,
  (ta.first_touch_at IS NOT NULL)        AS contacted,
  (c.converted AND ta.first_touch_at IS NOT NULL AND c.converted_at < analytics.ist_date(ta.first_touch_at)) AS paid_before_first_touch,
  (c.sf_touch_count IS DISTINCT FROM COALESCE(ta.total_touches,0)::double precision) AS sf_touch_count_mismatch,
  (c.sf_is_converted IS DISTINCT FROM c.converted) AS sf_converted_mismatch,
  CASE WHEN NOT c.converted AND c.lead_stage NOT IN ('Converted','Disqualified') THEN true ELSE false END AS is_open
FROM analytics.v_lead_conv c
LEFT JOIN ta ON ta.lead_id = c.lead_id;

-- ---------------------------------------------------------------------
-- Task / call activity, joined to leads on the normalised phone
-- (Task.Mobile_Number__c <-> Lead_Master__c.Mobile_Number__c)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_task_valid AS
SELECT
  t.id                                     AS task_id,
  analytics.phone_key(t.mobile_number__c)  AS phone_key,
  t.whatid,
  t.subject,
  t.type,
  t.status,
  t.activitydate                           AS activity_date,
  t.createddate                            AS task_created_at,
  t.calldurationinseconds                  AS call_seconds,
  t.call_status__c                         AS call_status,
  t.call_start_time__c                     AS call_start_at,
  t.reason__c                              AS reason,
  t.interested_course_status__c            AS ic_status,
  t.ownerid                                AS owner_id,
  (t.call_start_time__c IS NOT NULL OR t.call_status__c IS NOT NULL
     OR t.calldurationinseconds IS NOT NULL OR t.subject ILIKE '%call%') AS is_call,
  (t.call_status__c = 'ANSWERED' OR COALESCE(t.calldurationinseconds,0) > 0) AS is_connected
FROM salesforce.task t
WHERE COALESCE(t.isdeleted,false) = false
  AND analytics.phone_key(t.mobile_number__c) IS NOT NULL;

CREATE OR REPLACE VIEW analytics.v_lead_calls AS
SELECT
  l.lead_id,
  count(*)                                        AS task_count,
  count(*) FILTER (WHERE tv.is_call)              AS call_attempts,
  count(*) FILTER (WHERE tv.is_call AND tv.is_connected) AS calls_connected,
  sum(tv.call_seconds) FILTER (WHERE tv.is_connected)    AS call_seconds_total,
  avg(tv.call_seconds) FILTER (WHERE tv.is_connected AND tv.call_seconds > 0) AS call_seconds_avg,
  min(tv.call_start_at)                           AS first_call_at,
  max(COALESCE(tv.call_start_at, tv.task_created_at)) AS last_task_at,
  (array_agg(tv.reason ORDER BY tv.task_created_at DESC) FILTER (WHERE tv.reason IS NOT NULL))[1] AS last_reason
FROM analytics.v_lead_conv l
JOIN analytics.v_task_valid tv ON tv.phone_key = l.phone_key
GROUP BY l.lead_id;

-- ---------------------------------------------------------------------
-- Interested courses per lead (valid rows)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_ic_base AS
SELECT
  ic.id                     AS ic_id,
  ic.lead_master__c         AS lead_id,
  ic.course__c              AS course_id,
  COALESCE(NULLIF(ic.course_name__c,''), cr.name, ic.course__c) AS course_name,
  COALESCE(NULLIF(btrim(ic.status__c),''),'(blank)') AS status,
  COALESCE(ic.is_enrolled__c,false) AS is_enrolled,
  ic.fees_offered__c        AS fees_offered,
  ic.assigned_date__c       AS assigned_date,
  ic.target_customer__c     AS target_customer,
  ic.ad_campaign__c         AS ad_campaign,
  ic.occupation_categories__c AS occupation,
  ic.createddate            AS ic_created_at,
  ic.ownerid                AS owner_id
FROM salesforce.interested_course__c ic
LEFT JOIN salesforce.course__c cr ON cr.id = ic.course__c
WHERE COALESCE(ic.isdeleted,false) = false
  AND ic.lead_master__c IS NOT NULL;


-- ############################ 004_matviews ############################
-- =====================================================================
-- 004_matviews.sql   (run as postgres in the Supabase SQL editor, after 002 + 003)
--
-- Materialized views the API reads. They are exact snapshots of the views
-- in 003 so the definitions live in ONE place; MVs only add indexes and a
-- refresh log. Refresh with:  SELECT * FROM analytics.refresh_all();
-- (SECURITY DEFINER, so the read-only role used by the Worker Cron Trigger
--  can call it.)
-- =====================================================================
SET search_path = analytics, public;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_daily_lead_stats;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lead_base;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_touch_base;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lead_calls;
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_ic_base;

CREATE MATERIALIZED VIEW analytics.mv_touch_base AS SELECT * FROM analytics.v_touch_base WITH NO DATA;
CREATE MATERIALIZED VIEW analytics.mv_lead_base  AS SELECT * FROM analytics.v_lead_base  WITH NO DATA;
CREATE MATERIALIZED VIEW analytics.mv_lead_calls AS SELECT * FROM analytics.v_lead_calls WITH NO DATA;
CREATE MATERIALIZED VIEW analytics.mv_ic_base    AS SELECT * FROM analytics.v_ic_base    WITH NO DATA;

-- Pre-aggregated daily stats on the lead-created basis. The API uses this for
-- the Overview trend whenever the active filters are a subset of its
-- dimensions, and falls back to mv_lead_base otherwise.
CREATE MATERIALIZED VIEW analytics.mv_daily_lead_stats AS
SELECT
  created_date,
  lead_source, class_group, lead_stage, owner_name, district, is_duplicate, is_paid_lead,
  count(*)                                       AS leads,
  count(*) FILTER (WHERE converted)              AS converted,
  count(*) FILTER (WHERE converted AND NOT pre_existing_customer) AS converted_new,
  count(*) FILTER (WHERE first_touch_conversion) AS first_touch_conversions,
  count(*) FILTER (WHERE contacted)              AS contacted,
  sum(total_touches)                             AS total_touches,
  sum(valid_touches)                             AS valid_touches,
  sum(valid_touches) FILTER (WHERE converted)    AS touches_to_convert_sum,
  sum(revenue)                                   AS revenue,
  sum(days_to_convert) FILTER (WHERE converted AND days_to_convert >= 0) AS days_to_convert_sum,
  count(*) FILTER (WHERE converted AND days_to_convert >= 0)             AS days_to_convert_n,
  count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 7)  AS converted_7d,
  count(*) FILTER (WHERE converted AND days_to_convert BETWEEN 0 AND 30) AS converted_30d
FROM analytics.mv_lead_base
GROUP BY 1,2,3,4,5,6,7,8
WITH NO DATA;

-- Unique indexes are REQUIRED for REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX mv_touch_base_pk ON analytics.mv_touch_base (touch_id);
CREATE UNIQUE INDEX mv_lead_base_pk  ON analytics.mv_lead_base  (lead_id);
CREATE UNIQUE INDEX mv_lead_calls_pk ON analytics.mv_lead_calls (lead_id);
CREATE UNIQUE INDEX mv_ic_base_pk    ON analytics.mv_ic_base    (ic_id);
CREATE UNIQUE INDEX mv_daily_lead_stats_pk ON analytics.mv_daily_lead_stats
  (created_date, lead_source, class_group, lead_stage, owner_name, district, is_duplicate, is_paid_lead);

-- Query indexes (the API filters by these constantly)
CREATE INDEX mv_lead_base_created      ON analytics.mv_lead_base (created_date) INCLUDE (converted, revenue, valid_touches, is_duplicate);
CREATE INDEX mv_lead_base_converted_at ON analytics.mv_lead_base (converted_at) WHERE converted;
CREATE INDEX mv_lead_base_source       ON analytics.mv_lead_base (lead_source, created_date);
CREATE INDEX mv_lead_base_owner        ON analytics.mv_lead_base (owner_id, created_date);
CREATE INDEX mv_lead_base_class        ON analytics.mv_lead_base (class_group, created_date);
CREATE INDEX mv_lead_base_stage        ON analytics.mv_lead_base (lead_stage, created_date);
CREATE INDEX mv_lead_base_phone        ON analytics.mv_lead_base (phone_key);
CREATE INDEX mv_lead_base_name_trgm    ON analytics.mv_lead_base (lower(lead_name));
CREATE INDEX mv_lead_base_open_last    ON analytics.mv_lead_base (last_touch_any_at) WHERE is_open;

CREATE INDEX mv_touch_base_lead        ON analytics.mv_touch_base (lead_id, touch_at);
CREATE INDEX mv_touch_base_date        ON analytics.mv_touch_base (touch_date) INCLUDE (lead_id, is_pre_conversion);
CREATE INDEX mv_touch_base_point       ON analytics.mv_touch_base (touch_point, touch_date);
CREATE INDEX mv_touch_base_lead_created ON analytics.mv_touch_base (lead_created_date);
CREATE INDEX mv_touch_base_staff       ON analytics.mv_touch_base (staff) WHERE staff IS NOT NULL;

CREATE INDEX mv_ic_base_lead           ON analytics.mv_ic_base (lead_id);
CREATE INDEX mv_daily_lead_stats_date  ON analytics.mv_daily_lead_stats (created_date);

-- ---------------------------------------------------------------------
-- Refresh bookkeeping ("data as of" in the UI header)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.refresh_log (
  id           bigserial PRIMARY KEY,
  view_name    text        NOT NULL,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  ok           boolean,
  row_count    bigint,
  error        text
);
CREATE INDEX IF NOT EXISTS refresh_log_view_time ON analytics.refresh_log (view_name, started_at DESC);

CREATE OR REPLACE FUNCTION analytics.refresh_one(v regclass) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE
  log_id     bigint;
  populated  boolean;
  n          bigint;
BEGIN
  INSERT INTO analytics.refresh_log(view_name, started_at) VALUES (v::text, clock_timestamp()) RETURNING id INTO log_id;
  SELECT ispopulated INTO populated FROM pg_matviews
   WHERE schemaname = 'analytics' AND matviewname = split_part(v::text, '.', 2);
  IF populated THEN
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %s', v);
  ELSE
    EXECUTE format('REFRESH MATERIALIZED VIEW %s', v);
  END IF;
  EXECUTE format('SELECT count(*) FROM %s', v) INTO n;
  UPDATE analytics.refresh_log SET finished_at = clock_timestamp(), ok = true, row_count = n WHERE id = log_id;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  UPDATE analytics.refresh_log SET finished_at = clock_timestamp(), ok = false, error = SQLERRM WHERE id = log_id;
  RAISE;
END $$;

-- Refresh everything in dependency order. Returns one row per MV.
CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS TABLE(view_name text, row_count bigint, seconds numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = analytics, public AS $$
DECLARE
  v   text;
  t0  timestamptz;
  n   bigint;
BEGIN
  -- Prevent two overlapping refreshes (Cron + manual)
  IF NOT pg_try_advisory_lock(hashtext('analytics.refresh_all')) THEN
    RAISE NOTICE 'refresh_all already running';
    RETURN;
  END IF;
  BEGIN
    FOREACH v IN ARRAY ARRAY[
      'analytics.mv_touch_base',
      'analytics.mv_lead_base',
      'analytics.mv_lead_calls',
      'analytics.mv_ic_base',
      'analytics.mv_daily_lead_stats'] LOOP
      t0 := clock_timestamp();
      n  := analytics.refresh_one(v::regclass);
      view_name := v; row_count := n;
      seconds   := round(EXTRACT(epoch FROM clock_timestamp() - t0)::numeric, 1);
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
    RAISE;
  END;
  PERFORM pg_advisory_unlock(hashtext('analytics.refresh_all'));
END $$;

REVOKE ALL ON FUNCTION analytics.refresh_one(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.refresh_all()         FROM PUBLIC;

-- "data as of": last successful refresh of mv_lead_base + last sync watermark
CREATE OR REPLACE VIEW analytics.v_data_as_of AS
SELECT
  (SELECT max(finished_at) FROM analytics.refresh_log WHERE ok AND view_name = 'analytics.mv_lead_base') AS refreshed_at,
  (SELECT min(last_modstamp) FROM salesforce._sync_state WHERE object_name IN ('Lead_Master__c','Lead_Touch__c')) AS salesforce_as_of,
  (SELECT max(last_run_at) FROM salesforce._sync_state) AS last_sync_run_at,
  (SELECT max(_synced_at) FROM salesforce.lead_master__c) AS lead_master_synced_at,
  (SELECT count(*) FROM analytics.mv_lead_base)  AS lead_rows,
  (SELECT count(*) FROM analytics.mv_touch_base) AS touch_rows;


-- First population (non-concurrent because the MVs are empty)
SELECT * FROM analytics.refresh_all();


-- ############################ 006_data_quality ############################
-- =====================================================================
-- 006_data_quality.sql   (run as postgres in the Supabase SQL editor, after 004)
-- Every check is a view returning the offending rows; v_dq_summary counts them.
-- The API exposes /api/data-quality (summary) and /api/data-quality/:check (rows).
-- =====================================================================
SET search_path = analytics, public;

-- 1. Leads with no touches at all
CREATE OR REPLACE VIEW analytics.dq_leads_no_touches AS
SELECT lead_id, lead_name, created_date, lead_source, lead_stage, owner_name, class_group, converted
FROM analytics.mv_lead_base WHERE total_touches = 0;

-- 2. Touches whose Lead_Master__c is missing or points at a missing / deleted lead
CREATE OR REPLACE VIEW analytics.dq_orphan_touches AS
SELECT t.id AS touch_id, t.lead_master__c AS lead_id, t.touch_date__c AS touch_at, t.touch_point__c AS touch_point,
       t.source__c AS source, t.campaign__c AS campaign,
       CASE WHEN t.lead_master__c IS NULL THEN 'null lead id'
            WHEN l.id IS NULL THEN 'lead not found'
            ELSE 'lead deleted' END AS problem
FROM salesforce.lead_touch__c t
LEFT JOIN salesforce.lead_master__c l ON l.id = t.lead_master__c
WHERE COALESCE(t.isdeleted,false) = false
  AND (t.lead_master__c IS NULL OR l.id IS NULL OR l.is_deleted__c OR l.isdeleted);

-- 3. Lead phone numbers that do not normalise to a 10-digit Indian mobile
CREATE OR REPLACE VIEW analytics.dq_bad_lead_phones AS
SELECT lead_id, lead_name, created_date, lead_source, mobile AS raw_phone, phone_key,
       CASE WHEN mobile IS NULL OR btrim(mobile) = '' THEN 'blank'
            WHEN phone_key IS NULL THEN 'fewer than 10 digits'
            ELSE 'not 6-9xxxxxxxxx' END AS problem
FROM analytics.mv_lead_base WHERE NOT COALESCE(phone_valid,false);

-- 4. App users with payments whose phone does not normalise
CREATE OR REPLACE VIEW analytics.dq_bad_user_phones AS
SELECT u.id AS user_id, u.phone AS raw_phone, analytics.phone_key(u.phone) AS phone_key, count(vp.payment_id) AS valid_payments
FROM app.home_customuser u
JOIN analytics.v_valid_payment vp ON vp.user_id = u.id
WHERE NOT COALESCE(analytics.phone_key_valid(u.phone), false)
GROUP BY u.id, u.phone;

-- 5. Valid payments with no matching lead (by phone)
CREATE OR REPLACE VIEW analytics.dq_payments_no_lead AS
SELECT vp.payment_id, vp.user_id, vp.phone_key, vp.payment_date, vp.total, vp.course_new_id
FROM analytics.v_valid_payment vp
WHERE vp.phone_key IS NULL
   OR NOT EXISTS (SELECT 1 FROM analytics.mv_lead_base l WHERE l.phone_key = vp.phone_key);

-- 6a. Leads flagged duplicate in Salesforce
CREATE OR REPLACE VIEW analytics.dq_flagged_duplicates AS
SELECT lead_id, lead_name, created_date, phone_key, lead_source, parent_lead_id, converted
FROM analytics.mv_lead_base WHERE is_duplicate;

-- 6b. Same phone appearing on >1 non-duplicate lead (undetected duplicates)
CREATE OR REPLACE VIEW analytics.dq_phone_collisions AS
SELECT phone_key, count(*) AS leads, min(created_date) AS first_created, max(created_date) AS last_created,
       bool_or(converted) AS any_converted, array_agg(lead_id ORDER BY created_date) AS lead_ids
FROM analytics.mv_lead_base
WHERE phone_key IS NOT NULL AND NOT is_duplicate
GROUP BY phone_key HAVING count(*) > 1;

-- 7. Touch_Count__c on the lead disagrees with the actual number of touches
CREATE OR REPLACE VIEW analytics.dq_touch_count_mismatch AS
SELECT lead_id, lead_name, created_date, sf_touch_count, total_touches, (total_touches - sf_touch_count) AS diff
FROM analytics.mv_lead_base WHERE sf_touch_count_mismatch;

-- 8. Conversions where the payment predates the first touch (pre-existing customers)
CREATE OR REPLACE VIEW analytics.dq_paid_before_first_touch AS
SELECT lead_id, lead_name, created_date, converted_at, first_touch_date, (first_touch_date - converted_at) AS days_payment_before_touch,
       lead_source, first_touch_point, revenue
FROM analytics.mv_lead_base WHERE paid_before_first_touch;

-- 8b. Conversions where the payment predates the lead itself
CREATE OR REPLACE VIEW analytics.dq_paid_before_created AS
SELECT lead_id, lead_name, created_date, converted_at, (created_date - converted_at) AS days_payment_before_lead, lead_source, revenue
FROM analytics.mv_lead_base WHERE pre_existing_customer;

-- 9. Salesforce Is_Converted__c disagrees with the payment-based definition
CREATE OR REPLACE VIEW analytics.dq_sf_converted_mismatch AS
SELECT lead_id, lead_name, created_date, sf_is_converted, converted, converted_at, sf_converted_at, lead_stage, revenue
FROM analytics.mv_lead_base WHERE sf_converted_mismatch;

-- 10. Touches with blank touch point / source
CREATE OR REPLACE VIEW analytics.dq_blank_touch_attrs AS
SELECT touch_id, lead_id, touch_at, touch_point, source, medium, campaign
FROM analytics.mv_touch_base WHERE touch_point = '(blank)' OR source = '(blank)';

-- 11. Class values that fall into Unknown / Other (mapping coverage)
CREATE OR REPLACE VIEW analytics.dq_unmapped_class AS
SELECT class_raw, class_group, count(*) AS leads, count(*) FILTER (WHERE converted) AS converted
FROM analytics.mv_lead_base WHERE class_group IN ('Unknown','Other')
GROUP BY class_raw, class_group ORDER BY leads DESC;

-- Summary ------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_dq_summary AS
SELECT * FROM (VALUES
  ('leads_no_touches',        'Leads with no touches',                              (SELECT count(*) FROM analytics.dq_leads_no_touches),        (SELECT count(*) FROM analytics.mv_lead_base)),
  ('orphan_touches',          'Touches with missing / invalid Lead_Master__c',      (SELECT count(*) FROM analytics.dq_orphan_touches),          (SELECT count(*) FROM salesforce.lead_touch__c WHERE NOT isdeleted)),
  ('bad_lead_phones',         'Lead phones that fail to normalise',                 (SELECT count(*) FROM analytics.dq_bad_lead_phones),         (SELECT count(*) FROM analytics.mv_lead_base)),
  ('bad_user_phones',         'Paying app users whose phone fails to normalise',    (SELECT count(*) FROM analytics.dq_bad_user_phones),         (SELECT count(DISTINCT user_id) FROM analytics.v_valid_payment)),
  ('payments_no_lead',        'Valid payments with no matching lead',               (SELECT count(*) FROM analytics.dq_payments_no_lead),        (SELECT count(*) FROM analytics.v_valid_payment)),
  ('flagged_duplicates',      'Leads flagged Is_Duplicate__c',                      (SELECT count(*) FROM analytics.dq_flagged_duplicates),      (SELECT count(*) FROM analytics.mv_lead_base)),
  ('phone_collisions',        'Phones shared by >1 non-duplicate lead',             (SELECT count(*) FROM analytics.dq_phone_collisions),        (SELECT count(DISTINCT phone_key) FROM analytics.mv_lead_base)),
  ('touch_count_mismatch',    'Touch_Count__c differs from actual touches',         (SELECT count(*) FROM analytics.dq_touch_count_mismatch),    (SELECT count(*) FROM analytics.mv_lead_base)),
  ('paid_before_first_touch', 'Conversions with payment before first touch',        (SELECT count(*) FROM analytics.dq_paid_before_first_touch), (SELECT count(*) FROM analytics.mv_lead_base WHERE converted)),
  ('paid_before_created',     'Conversions with payment before lead creation',      (SELECT count(*) FROM analytics.dq_paid_before_created),     (SELECT count(*) FROM analytics.mv_lead_base WHERE converted)),
  ('sf_converted_mismatch',   'Is_Converted__c disagrees with payment definition',  (SELECT count(*) FROM analytics.dq_sf_converted_mismatch),   (SELECT count(*) FROM analytics.mv_lead_base)),
  ('blank_touch_attrs',       'Touches with blank touch point or source',           (SELECT count(*) FROM analytics.dq_blank_touch_attrs),       (SELECT count(*) FROM analytics.mv_touch_base)),
  ('unmapped_class',          'Leads in class group Unknown / Other',               (SELECT count(*) FROM analytics.mv_lead_base WHERE class_group IN ('Unknown','Other')), (SELECT count(*) FROM analytics.mv_lead_base))
) AS v(check_key, label, bad_rows, total_rows);



-- ############################ 005_indexes ############################
-- =====================================================================
-- 005_indexes.sql
-- Base-table indexes. Run BEFORE the first sync (tables are empty, so plain
-- CREATE INDEX is instant) - safe in the Supabase SQL editor or via psql:
--   psql "$OWNER_DATABASE_URL" -f sql/005_indexes.sql
-- =====================================================================

-- Salesforce replica ------------------------------------------------------
CREATE INDEX IF NOT EXISTS lead_touch_lead_date
  ON salesforce.lead_touch__c (lead_master__c, touch_date__c) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS lead_touch_date
  ON salesforce.lead_touch__c (touch_date__c) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS lead_touch_modstamp
  ON salesforce.lead_touch__c (systemmodstamp);

CREATE INDEX IF NOT EXISTS lead_master_created
  ON salesforce.lead_master__c (createddate) WHERE is_deleted__c = false AND isdeleted = false;
CREATE INDEX IF NOT EXISTS lead_master_phone_key
  ON salesforce.lead_master__c (analytics.phone_key(mobile_number__c));
CREATE INDEX IF NOT EXISTS lead_master_owner
  ON salesforce.lead_master__c (ownerid);
CREATE INDEX IF NOT EXISTS lead_master_parent
  ON salesforce.lead_master__c (parent_lead_master__c) WHERE parent_lead_master__c IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_master_modstamp
  ON salesforce.lead_master__c (systemmodstamp);

CREATE INDEX IF NOT EXISTS interested_course_lead
  ON salesforce.interested_course__c (lead_master__c) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS interested_course_modstamp
  ON salesforce.interested_course__c (systemmodstamp);

CREATE INDEX IF NOT EXISTS task_phone_key
  ON salesforce.task (analytics.phone_key(mobile_number__c)) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS task_owner_created
  ON salesforce.task (ownerid, createddate) WHERE isdeleted = false;
CREATE INDEX IF NOT EXISTS task_modstamp
  ON salesforce.task (systemmodstamp);

-- App replica tables (schema app, filled by sync from the production DB) ------
-- Replica of the production tables; created empty by 001, so plain CREATE INDEX is fine.
-- The composite below lets the valid-payment scan be index-only.
CREATE INDEX IF NOT EXISTS home_payment_user_paydate_valid
  ON app.home_payment (user_id, payment_date)
  WHERE payment_method = 0 AND deleted = false AND is_success = true AND payment_success = true;

CREATE INDEX IF NOT EXISTS home_customuser_phone_key
  ON app.home_customuser (analytics.phone_key(phone)) WHERE is_deleted = false;

ANALYZE salesforce.lead_master__c;
ANALYZE salesforce.lead_touch__c;
ANALYZE salesforce.interested_course__c;
ANALYZE salesforce.task;


-- ############################ final check (must return 0 rows) ############################
SELECT * FROM analytics.class_group_selftest() WHERE NOT ok;
