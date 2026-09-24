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

/** JSON call to /api/auth/* (cookie session; same-origin). Throws Error(message) on non-2xx. */
export async function authCall<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw Object.assign(new Error(j.error?.message ?? res.statusText), { status: res.status });
  return j.data as T;
}

/** 14-char random password: letters + digits, always at least one digit. */
export function generatePassword(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(14));
  let out = Array.from(buf, (b) => alpha[b % alpha.length]).join('');
  if (!/[0-9]/.test(out)) out = out.slice(0, -1) + String(buf[0]! % 10);
  return out;
}
