-- 031: shared CSV export password (set by admins on the Access page, asked for on every CSV download)
-- The hash lives in a tiny key/value table so further app settings can reuse it.
CREATE TABLE IF NOT EXISTS app_auth.settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
COMMENT ON TABLE app_auth.settings IS 'App settings; export_password = pbkdf2 hash of the shared CSV export password';
