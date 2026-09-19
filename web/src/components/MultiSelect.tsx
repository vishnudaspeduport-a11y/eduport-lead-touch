import { useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import type { FiltersResponse } from '../lib/types';
import { fmtInt } from '../lib/format';
import { Skeleton, useDebounce } from './ui';

/** Searchable multi-select whose options cascade from every OTHER active filter (server side). */
export function MultiSelect({ dim, onDone }: { dim: ListDim; onDone?: () => void }) {
  const { f, params, setList } = useFilters();
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const selected = f.lists[dim] ?? [];
  const { data, isLoading, error } = useApi<FiltersResponse>('/filters', { ...params, dim, q: dq, limit: 150 });
  const options = data?.data.options ?? [];
  // keep selected values visible even if they fall out of the top-N
  const merged = [...options, ...selected.filter((s) => !options.some((o) => o.value === s)).map((value) => ({ value, leads: 0, converted: 0 }))];
  const toggle = (v: string) => setList(dim, selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="flex max-h-80 flex-col gap-2">
      <input autoFocus className="input w-full" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex items-center justify-between text-[11px] text-ink-3">
        <span>{selected.length} selected · counts reflect other filters</span>
        <div className="flex gap-2">
          <button className="hover:text-ink" onClick={() => setList(dim, [])}>Clear</button>
          <button className="hover:text-ink" onClick={() => setList(dim, merged.map((o) => o.value))}>All shown</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-line">
        {isLoading && <div className="space-y-1 p-2"><Skeleton /><Skeleton /><Skeleton /></div>}
        {error && <div className="p-2 text-xs text-[#d03b3b]">{error.message}</div>}
        {merged.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-accent/5">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            <span className="min-w-0 flex-1 truncate" title={o.value}>{o.value}</span>
            <span className="tabular-nums text-ink-3">{fmtInt(o.leads)}</span>
          </label>
        ))}
        {!isLoading && merged.length === 0 && <div className="p-3 text-center text-xs text-ink-3">No options</div>}
      </div>
      {onDone && <button className="btn btn-primary justify-center" onClick={onDone}>Done</button>}
    </div>
  );
}
