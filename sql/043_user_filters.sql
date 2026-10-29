-- 043 (2026-10-29): "Save filter" - one saved filter set per dashboard user (keyed by e-mail; 'public' when there is no login).
-- GET / PUT / DELETE /api/auth/filter. On a bare URL the web app applies the saved filter set before the browser's sticky one.
CREATE TABLE IF NOT EXISTS app_auth.user_filters (
  email     text PRIMARY KEY,
  query     text NOT NULL,            -- the filter bar's URL query string (preset, from, to, basis, lists ...)
  saved_at  timestamptz NOT NULL DEFAULT now()
);
