import { useState } from 'react';
import { DIM_LABEL, FILTER_MENU, PRESETS, useFilters, type Basis, type ListDim } from '../lib/filters';
import { Icon, Popover, Segmented, Toggle } from './ui';
import { MultiSelect } from './MultiSelect';

export function FilterBar() {
  const { f, set, setList, clearAll, activeCount } = useFilters();
  const [openDim, setOpenDim] = useState<ListDim | null>(null);

  const chips: { label: string; onRemove: () => void }[] = [];
  for (const [k, vals] of Object.entries(f.lists)) if (vals?.length) chips.push({ label: `${DIM_LABEL[k] ?? k}: ${vals.length > 2 ? `${vals.slice(0, 2).join(', ')} +${vals.length - 2}` : vals.join(', ')}`, onRemove: () => setList(k as ListDim, []) });
  for (const [k, v] of Object.entries(f.flags)) if (v) chips.push({ label: `${DIM_LABEL[k] ?? k}: ${v === '1' ? 'yes' : 'no'}`, onRemove: () => set((p) => ({ ...p, flags: { ...p.flags, [k]: undefined } })) });
  if (f.paid) chips.push({ label: `${f.paid === 'paid' ? 'Paid' : 'Organic'} leads`, onRemove: () => set({ paid: undefined }) });

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-line bg-surface-2/95 px-4 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        {/* date preset */}
        <select className="input !py-1 text-xs" value={f.preset} onChange={(e) => { const p = PRESETS.find((x) => x.key === e.target.value)!; const [from, to] = p.range(); set({ preset: p.key, from, to }); }}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <input type="date" className="input !py-1 text-xs" value={f.from} max={f.to} onChange={(e) => set({ preset: 'custom', from: e.target.value })} />
        <span className="text-xs text-ink-3">to</span>
        <input type="date" className="input !py-1 text-xs" value={f.to} min={f.from} onChange={(e) => set({ preset: 'custom', to: e.target.value })} />

        <Segmented<Basis> value={f.basis} onChange={(basis) => set({ basis })} size="xs"
          options={[{ value: 'created', label: 'Lead created', title: 'Window on Lead_Master__c.CreatedDate' }, { value: 'touch', label: 'Touch date', title: 'Leads with a touch in the window; touches counted by Touch_Date__c' }, { value: 'payment', label: 'Payment date', title: 'Leads whose first valid payment falls in the window' }]} />

        <Toggle checked={f.compare} onChange={(compare) => set({ compare })} label="vs previous period" />
        <Toggle checked={f.converted} onChange={(converted) => set({ converted })} label="Converted only" />
        <Toggle checked={f.dups} onChange={(dups) => set({ dups })} label="Include duplicates" title="Is_Duplicate__c = true rows are excluded by default" />
        <Segmented<'all' | 'paid' | 'organic'> size="xs" value={f.paid ?? 'all'} onChange={(v) => set({ paid: v === 'all' ? undefined : v })} options={[{ value: 'all', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'organic', label: 'Organic' }]} />

        <Popover width="w-72" trigger={<button className="btn"><Icon.Plus /> Add filter</button>}>
          {(close) => (
            <div className="max-h-80 overflow-auto">
              {['Lead', 'Touch'].map((g) => (
                <div key={g}>
                  <div className="px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{g}</div>
                  {FILTER_MENU.filter((m) => m.group === g).map((m) => (
                    <button key={m.key} className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent/5" onClick={() => { setOpenDim(m.key); close(); }}>
                      <span>{m.label}</span>{f.lists[m.key]?.length ? <span className="chip">{f.lists[m.key]!.length}</span> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Popover>
        {activeCount > 0 && <button className="btn" onClick={clearAll}><Icon.Close /> Clear {activeCount}</button>}
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c.label} className="chip">
              <button className="hover:text-ink" onClick={() => { const k = Object.keys(DIM_LABEL).find((k) => c.label.startsWith(`${DIM_LABEL[k]}:`)); if (k && FILTER_MENU.some((m) => m.key === k)) setOpenDim(k as ListDim); }}>{c.label}</button>
              <button className="text-ink-3 hover:text-ink" onClick={c.onRemove} title="Remove"><Icon.Close /></button>
            </span>
          ))}
        </div>
      )}

      {openDim && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={() => setOpenDim(null)}>
          <div className="w-[420px] max-w-full rounded-lg border border-line bg-surface p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><div className="text-sm font-semibold">{DIM_LABEL[openDim]}</div><button className="text-ink-3 hover:text-ink" onClick={() => setOpenDim(null)}><Icon.Close /></button></div>
            <MultiSelect dim={openDim} onDone={() => setOpenDim(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
