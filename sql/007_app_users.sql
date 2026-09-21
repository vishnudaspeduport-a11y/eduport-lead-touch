-- Optional allow-list for the web app login (Supabase Auth).
-- Anyone with an @ALLOWED_EMAIL_DOMAIN address is a viewer automatically and
-- ADMIN_EMAILS (wrangler.toml) are admins; this table is only for extra people.
CREATE TABLE IF NOT EXISTS public.app_users (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  role        text NOT NULL CHECK (role IN ('admin','viewer')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_users_self ON public.app_users;
CREATE POLICY app_users_self ON public.app_users FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Make someone an admin after they have signed up once in the app:
-- INSERT INTO public.app_users (user_id, email, role)
-- SELECT id, email, 'admin' FROM auth.users WHERE email = 'someone@eduport.ai'
-- ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
