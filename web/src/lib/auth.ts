import { createContext, useContext } from 'react';

export type AccountRole = 'admin' | 'user';
export interface Account { id: number | null; email: string; name: string; role: AccountRole }
export interface AuthStatus { mode: 'password' | 'none'; setup_required: boolean; user: Account | null }

export interface AuthCtx {
  user: Account | null;
  mode: 'password' | 'none';
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
export const AuthContext = createContext<AuthCtx>({ user: null, mode: 'none', refresh: async () => undefined, logout: async () => undefined });
export const useAuth = () => useContext(AuthContext);

/** JSON call to /api/auth/* (cookie session; same-origin). Throws Error(message) on non-2xx.
 *  A dropped connection / proxy 5xx is retried once after a short pause (wrangler remote dev drops the odd POST). */
export async function authCall<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}, attempt = 0): Promise<T> {
  let res: Response;
  try { res = await doFetch(path, init); }
  catch (e) { if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); return authCall<T>(path, init, 1); } throw new Error('Cannot reach the server: ' + (e as Error).message); }
  if (res.status >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 800)); return authCall<T>(path, init, 1); }
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw Object.assign(new Error(j.error?.message ?? (res.status >= 500 ? 'Server error, please try again' : res.statusText)), { status: res.status, retried: attempt === 1 });
  return j.data as T;
}
function doFetch(path: string, init: { method?: string; body?: unknown }): Promise<Response> {
  return fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
}

/** 14-char random password: letters + digits, always at least one digit. */
export function generatePassword(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(14));
  let out = Array.from(buf, (b) => alpha[b % alpha.length]).join('');
  if (!/[0-9]/.test(out)) out = out.slice(0, -1) + String(buf[0]! % 10);
  return out;
}
