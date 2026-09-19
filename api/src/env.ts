export interface Env {
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
  AUTH_MODE: 'access' | 'dev';
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  DEV_USER_EMAIL?: string;
  APP_VERSION?: string;
  EXPORT_ROW_CAP?: string;
}

export type Role = 'admin' | 'viewer';
export interface User { email: string; role: Role; }

export type AppEnv = { Bindings: Env; Variables: { user: User } };
