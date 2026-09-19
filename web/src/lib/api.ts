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

export async function apiFetch<T>(path: string, params: Params = {}): Promise<Envelope<T>> {
  const res = await fetch(`/api${path}${qs(params)}`, { credentials: 'include', headers: { accept: 'application/json' } });
  if (res.status === 401) {
    // Cloudflare Access session expired: reload to re-authenticate
    window.location.reload();
    throw new ApiError(401, 'Session expired');
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T> & { error?: { message: string; issues?: unknown } };
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
