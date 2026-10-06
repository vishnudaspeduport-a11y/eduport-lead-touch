import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { Envelope } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: unknown) { super(message); }
}

export type Params = Record<string, string | number | boolean | undefined | null>;

export function qs(params: Params): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Listeners for auth failures (the app shows the login screen) */
const authListeners = new Set<(status: 401 | 403, message: string) => void>();
export function onAuthError(fn: (status: 401 | 403, message: string) => void) { authListeners.add(fn); return () => { authListeners.delete(fn); }; }

/** Kept for call sites that spread it; the session is an HttpOnly cookie now, so nothing to add. */
export async function authHeaders(): Promise<Record<string, string>> { return {}; }

export async function apiFetch<T>(path: string, params: Params = {}): Promise<Envelope<T>> {
  const res = await fetch(`/api${path}${qs(params)}`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as Envelope<T> & { error?: { message: string; issues?: unknown } };
  if (res.status === 401 || res.status === 403) authListeners.forEach((l) => l(res.status as 401 | 403, body.error?.message ?? res.statusText));
  if (!res.ok) throw new ApiError(res.status, body.error?.message ?? res.statusText, body.error?.issues);
  return body;
}

export function useApi<T>(path: string, params: Params = {}, opts: Partial<UseQueryOptions<Envelope<T>, ApiError>> = {}) {
  return useQuery<Envelope<T>, ApiError>({
    queryKey: [path, params],
    queryFn: () => apiFetch<T>(path, params),
    ...opts,
  });
}

export function downloadUrl(path: string, params: Params): string {
  return `/api${path}${qs(params)}`;
}

/** Download via fetch so errors surface as JSON instead of a broken file. */
export async function downloadWithAuth(path: string, params: Params, filename: string, exportPassword?: string): Promise<void> {
  const res = await fetch(`/api${path}${qs(params)}`, { credentials: 'same-origin', headers: exportPassword ? { 'x-export-password': exportPassword } : {} });
  if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }; throw new ApiError(res.status, j.error?.message ?? res.statusText); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
