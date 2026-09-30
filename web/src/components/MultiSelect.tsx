import { useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import type { FiltersResponse } from '../lib/types';
import { fmtInt } from '../lib/format';
import { Skeleton, useDebounce } from './ui';

/** Searchable multi-select whose options cascade from every OTHER active filter (server side). */
type Opt = { value: string; leads: number; converted: number; outside?: boolean; leads_all?: number; first_touch?: string; last_touch?: string };

export function MultiSelect({ dim, onDone }: { dim: ListDim; onDone?: () => void }) {
  const { f, params, setList } = useFilters();
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const selected = f.lists[dim] ?? [];
  const { data, isLoading, error } = useApi<FiltersResponse>('/filters', { ...params, dim, q: dq, limit: 5000 });
  const options = (data?.data.options ?? []) as Opt[];
  // every value is listed (no top-N cut); selected values stay visible even when the current filters leave them no leads
  const merged: Opt[] = [...options, ...selected.filter((s) => !options.some((o) => o.value === s)).map((value) => ({ value, leads: 0, converted: 0 }))];
  const inside = merged.filter((o) => !o.outside);
  const toggle = (v: string) => setList(dim, selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="flex max-h-80 flex-col gap-2">
      <input autoFocus className="input w-full" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex items-center justify-between text-[11px] text-ink-3">
        <span>{selected.length} selected · counts reflect other filters</span>
        <div className="flex gap-2">
          <button className="hover:text-ink" onClick={() => setList(dim, [])}>Clear</button>
          <button className="hover:text-ink" onClick={() => setList(dim, inside.map((o) => o.value))}>All shown</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-line">
        {isLoading && <div className="space-y-1 p-2"><Skeleton /><Skeleton /><Skeleton /></div>}
        {error && <div className="p-2 text-xs text-[#d03b3b]">{error.message}</div>}
        {merged.map((o, i) => (
          <div key={o.value}>
            {o.outside && !merged[i - 1]?.outside && (
              <div className="border-t border-line bg-surface-2 px-2 py-1 text-[10.5px] leading-snug text-ink-3">Found, but no leads under the filters and dates now on the page. Selecting one will show nothing until you widen them.</div>
            )}
            <label className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-accent/5 ${o.outside ? 'text-ink-3' : ''}`}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="min-w-0 flex-1 truncate" title={o.value}>{o.value}</span>
              <span className="tabular-nums text-ink-3" title={o.outside ? `${fmtInt(o.leads_all ?? 0)} leads in all data, touched ${o.first_touch} → ${o.last_touch}` : undefined}>{o.outside ? `${fmtInt(o.leads_all ?? 0)} · ${o.first_touch?.slice(5)} → ${o.last_touch?.slice(5)}` : fmtInt(o.leads)}</span>
            </label>
          </div>
        ))}
        {!isLoading && merged.length === 0 && <div className="p-3 text-center text-xs text-ink-3">No options</div>}
      </div>
      {onDone && <button className="btn btn-primary justify-center" onClick={onDone}>Done</button>}
    </div>
  );
}
