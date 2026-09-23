-- 013 (2026-09-23): batch / course lookup copied from the production app DB (public.core_batch + core_syllabusstructure title)
-- so payments and lead lists can show names instead of ids. ~3.6k rows.
CREATE TABLE IF NOT EXISTS app.core_batch (
  id            bigint PRIMARY KEY,
  title         text,
  course_id     bigint,
  course_title  text,
  grade_title   text,
  course_fee    numeric,
  is_premium    boolean,
  is_deleted    boolean,
  expiry_date   date,
  updated_at    timestamptz,
  _synced_at    timestamptz
);
