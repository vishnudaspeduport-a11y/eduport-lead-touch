export interface Env {
  /** Optional Hyperdrive binding; when absent the Worker uses DATABASE_URL (a Worker secret). */
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  ASSETS: Fetcher;
  /** Workers KV namespace for the response cache (cache.ts); optional, the app works without it (memory layer only) */
  CACHE?: KVNamespace;
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
  /** set per deploy by scripts/deploy.mjs (git sha + time); part of every cache key so a deploy invalidates cached answers */
  BUILD_ID?: string;
  /** "dev" under wrangler dev (set by .claude/launch.json): cache keys get a per-isolate id instead of BUILD_ID */
  CACHE_SCOPE?: string;
  EXPORT_ROW_CAP?: string;
}

/** admin = manages accounts + admin actions; analyst = full lead details (account role "user" = Manager);
 *  bde = phone numbers masked, no Lead explorer, no downloads (account role "bde"); viewer = all PII masked (AUTH_MODE=none only) */
export type Role = 'admin' | 'analyst' | 'bde' | 'viewer';
export interface User { email: string; role: Role; id?: number; name?: string; }

export type AppEnv = { Bindings: Env; Variables: { user: User } };
