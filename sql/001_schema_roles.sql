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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lt_analytics_owner') THEN
    CREATE ROLE lt_analytics_owner LOGIN PASSWORD 'CHANGE_ME_owner' NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lt_app_ro') THEN
    CREATE ROLE lt_app_ro LOGIN PASSWORD 'CHANGE_ME_ro' NOINHERIT;
  END IF;
END $$;

ALTER ROLE lt_app_ro SET default_transaction_read_only = on;
ALTER ROLE lt_app_ro SET statement_timeout = '20s';
ALTER ROLE lt_app_ro SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE lt_analytics_owner SET statement_timeout = '60min';

-- Objects stay owned by the user running this file (postgres in Supabase);
-- the two service roles only get the privileges they need.
CREATE SCHEMA IF NOT EXISTS salesforce;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS analytics;

GRANT USAGE ON SCHEMA salesforce, app, analytics TO lt_app_ro, lt_analytics_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA salesforce GRANT SELECT ON TABLES TO lt_app_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA app        GRANT SELECT ON TABLES TO lt_app_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics  GRANT SELECT ON TABLES TO lt_app_ro, lt_analytics_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics  GRANT EXECUTE ON FUNCTIONS TO lt_app_ro, lt_analytics_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA salesforce GRANT ALL ON TABLES TO lt_analytics_owner;   -- sync writes here
ALTER DEFAULT PRIVILEGES IN SCHEMA app        GRANT ALL ON TABLES TO lt_analytics_owner;

-- Belt and braces: never expose these schemas to the Supabase API roles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA salesforce, app, analytics FROM anon, authenticated;
  END IF;
END $$;

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

GRANT SELECT ON ALL TABLES IN SCHEMA salesforce, app TO lt_app_ro;
GRANT ALL    ON ALL TABLES IN SCHEMA salesforce, app TO lt_analytics_owner;
