-- 039 (2026-10-23): third account role "bde" (phone numbers masked, no Lead explorer, no downloads).
-- Account roles: admin (everything + Access page), user (= Manager view: full details and downloads), bde.
ALTER TABLE app_auth.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE app_auth.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'bde'));
SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'app_auth.users'::regclass AND contype = 'c';
