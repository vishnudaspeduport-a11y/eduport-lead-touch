-- Dashboard login (AUTH_MODE=password): accounts and cookie sessions managed by the app itself.
-- Admins create every account and set every password from the "Access" page; there is no self sign-up.
-- Passwords are stored as PBKDF2-SHA256 (100k iterations, random salt); sessions store only a SHA-256 of the cookie token.
CREATE SCHEMA IF NOT EXISTS app_auth;

CREATE TABLE IF NOT EXISTS app_auth.users (
  id               bigserial PRIMARY KEY,
  email            text NOT NULL,
  name             text NOT NULL DEFAULT '',
  role             text NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash    text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  failed_attempts  int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  password_set_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON app_auth.users (lower(email));

CREATE TABLE IF NOT EXISTS app_auth.sessions (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES app_auth.users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text,
  ip            text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON app_auth.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON app_auth.sessions (expires_at);

-- who did what on the Access page (create / password reset / role change / deactivate / delete)
CREATE TABLE IF NOT EXISTS app_auth.audit (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL,
  action      text NOT NULL,
  target      text,
  detail      text
);
