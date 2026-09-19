import { useApi } from '../lib/api';
import type { Meta } from '../lib/types';

export function useMeta() {
  const q = useApi<Meta>('/meta', {}, { staleTime: 60_000 });
  return { ...q, data: q.data?.data };
}
