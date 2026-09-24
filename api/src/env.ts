export interface Env {
  /** Optional Hyperdrive binding; when absent the Worker uses DATABASE_URL (a Worker secret). */
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  ASSETS: Fetcher;
  /** password = login page, accounts managed in-app (app_auth.*); none = no login (everyone gets PUBLIC_ROLE) */
  AUTH_MODE: 'password' | 'none';
  PUBLIC_ROLE?: 'admin' | 'analyst' | 'viewer';
  SUPABASE_URL: string;
  /** E-mails allowed to create the FIRST admin account (setup screen shown while app_auth.users is empty). */
  ADMIN_EMAILS: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  /** Manual sync button: fine-grained GitHub PAT (Actions: read+write on the repo) + owner/repo */
  GITHUB_TOKEN?: string;
  GITHUB_REPO: string;
  APP_VERSION?: string;
  EXPORT_ROW_CAP?: string;
}

/** admin = manages accounts + admin actions; analyst = full lead details; viewer = PII masked (AUTH_MODE=none only) */
export type Role = 'admin' | 'analyst' | 'viewer';
export interface User { email: string; role: Role; id?: number; name?: string; }

export type AppEnv = { Bindings: Env; Variables: { user: User } };
