export interface Env {
  /** Optional Hyperdrive binding; when absent the Worker uses DATABASE_URL (a Worker secret). */
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  ASSETS: Fetcher;
  /** none = no login (everyone gets PUBLIC_ROLE); supabase = Supabase Auth; dev = local */
  AUTH_MODE: 'none' | 'supabase' | 'dev';
  PUBLIC_ROLE?: 'admin' | 'viewer';
  SUPABASE_URL: string;
  /** Legacy HS256 projects only; new projects are verified via JWKS. */
  SUPABASE_JWT_SECRET?: string;
  ADMIN_EMAILS: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  DEV_USER_EMAIL?: string;
  APP_VERSION?: string;
  EXPORT_ROW_CAP?: string;
}

export type Role = 'admin' | 'viewer';
export interface User { email: string; role: Role; }

export type AppEnv = { Bindings: Env; Variables: { user: User } };
