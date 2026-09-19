/**
 * Global filter state = the URL search params (sticky via localStorage,
 * shareable via link). Every page reads `params` and passes it to the API.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type Basis = 'created' | 'touch' | 'payment';

export const LIST_DIMS = [
  'lead_source', 'lead_source_detail', 'lead_stage', 'class_group', 'class_raw', 'district', 'city', 'state', 'priority', 'lead_type', 'owner',
  'ic_course', 'ic_status', 'app_tier', 'campaign_quality', 'campaign_name', 'ad_campaign', 'lead_ad_set', 'lead_ad_name', 'ad_platform', 'ad_class',
  'class_match', 'first_touch_point', 'last_touch_point', 'touch_bucket', 'lm_reason',
  'source', 'medium', 'touch_point', 'campaign', 'ad_set', 'ad_name', 'staff', 'platform_id', 'gap_bucket',
] as const;
export type ListDim = (typeof LIST_DIMS)[number];

/** The filter chips shown in the "Add filter" menu, in this order */
export const FILTER_MENU: { key: ListDim; label: string; group: string }[] = [
  { key: 'lead_source', label: 'Lead Source', group: 'Lead' },
  { key: 'lead_stage', label: 'Lead Stage', group: 'Lead' },
  { key: 'class_group', label: 'Class Group', group: 'Lead' },
  { key: 'district', label: 'District', group: 'Lead' },
  { key: 'city', label: 'City', group: 'Lead' },
  { key: 'priority', label: 'Priority', group: 'Lead' },
  { key: 'lead_type', label: 'Lead Type', group: 'Lead' },
  { key: 'owner', label: 'Owner (sales staff)', group: 'Lead' },
  { key: 'ic_course', label: 'IC Course', group: 'Lead' },
  { key: 'ic_status', label: 'IC Status', group: 'Lead' },
  { key: 'app_tier', label: 'App Engagement Tier', group: 'Lead' },
  { key: 'campaign_quality', label: 'Campaign Quality', group: 'Lead' },
  { key: 'class_match', label: 'Ad Class Match', group: 'Lead' },
  { key: 'first_touch_point', label: 'First Touch Point', group: 'Lead' },
  { key: 'last_touch_point', label: 'Last Touch Point', group: 'Lead' },
  { key: 'touch_point', label: 'Touch Point', group: 'Touch' },
  { key: 'source', label: 'Source (touch)', group: 'Touch' },
  { key: 'medium', label: 'Medium', group: 'Touch' },
  { key: 'campaign', label: 'Campaign', group: 'Touch' },
  { key: 'ad_set', label: 'Ad Set', group: 'Touch' },
  { key: 'ad_name', label: 'Ad', group: 'Touch' },
  { key: 'staff', label: 'Staff (touch)', group: 'Touch' },
];
export const DIM_LABEL: Record<string, string> = Object.fromEntries(FILTER_MENU.map((m) => [m.key, m.label]));
Object.assign(DIM_LABEL, {
  lead_source_detail: 'Lead Source Detail', class_raw: 'Class (raw)', state: 'State', campaign_name: 'Campaign Name', ad_campaign: 'Ad Campaign',
  lead_ad_set: 'Ad Set (lead)', lead_ad_name: 'Ad (lead)', ad_platform: 'Ad Platform', ad_class: 'Ad Class', touch_bucket: 'Touches', lm_reason: 'LM Reason',
  platform_id: 'Platform ID', gap_bucket: 'Gap bucket', paid: 'Paid / Organic', paid_touch: 'Paid touch', hot: 'Hot', supreme_hot: 'Supreme Hot',
  relogged: 'Re-logged', repeat: 'Repeat lead', pre_existing: 'Pre-existing customer',
});

export interface FilterState {
  from: string; to: string; preset: string; basis: Basis; compare: boolean;
  converted: boolean; dups: boolean; paid?: 'paid' | 'organic';
  lists: Partial<Record<ListDim, string[]>>;
  flags: Partial<Record<'hot' | 'supreme_hot' | 'relogged' | 'repeat' | 'pre_existing', '1' | '0'>>;
}

// ---------------------------------------------------------------- dates (IST)
const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function todayIST(): Date { const d = new Date(Date.now() + 5.5 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400e3);

export const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'today', label: 'Today', range: () => { const t = todayIST(); return [fmtDate(t), fmtDate(t)]; } },
  { key: 'yesterday', label: 'Yesterday', range: () => { const t = addDays(todayIST(), -1); return [fmtDate(t), fmtDate(t)]; } },
  { key: '7d', label: 'Last 7 days', range: () => { const t = todayIST(); return [fmtDate(addDays(t, -6)), fmtDate(t)]; } },
  { key: '30d', label: 'Last 30 days', range: () => { const t = todayIST(); return [fmtDate(addDays(t, -29)), fmtDate(t)]; } },
  { key: '90d', label: 'Last 90 days', range: () => { const t = todayIST(); return [fmtDate(addDays(t, -89)), fmtDate(t)]; } },
  { key: 'mtd', label: 'This month', range: () => { const t = todayIST(); return [fmtDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), fmtDate(t)]; } },
  { key: 'lastm', label: 'Last month', range: () => { const t = todayIST(); const s = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)); const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)); return [fmtDate(s), fmtDate(e)]; } },
  { key: 'fy', label: 'This FY (Apr-Mar)', range: () => { const t = todayIST(); const y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1; return [fmtDate(new Date(Date.UTC(y, 3, 1))), fmtDate(t)]; } },
  { key: 'custom', label: 'Custom', range: () => { const t = todayIST(); return [fmtDate(addDays(t, -29)), fmtDate(t)]; } },
];

const STORAGE_KEY = 'lt-filters-v1';

function parse(sp: URLSearchParams): FilterState {
  const preset = sp.get('preset') ?? '30d';
  const p = PRESETS.find((x) => x.key === preset) ?? PRESETS[3];
  const [df, dt] = p.range();
  const lists: FilterState['lists'] = {};
  for (const k of LIST_DIMS) { const v = sp.get(k); if (v) lists[k] = v.split(',').filter(Boolean); }
  const flags: FilterState['flags'] = {};
  for (const k of ['hot', 'supreme_hot', 'relogged', 'repeat', 'pre_existing'] as const) { const v = sp.get(k); if (v === '1' || v === '0') flags[k] = v; }
  const paid = sp.get('paid');
  return {
    from: preset === 'custom' ? sp.get('from') ?? df : df,
    to: preset === 'custom' ? sp.get('to') ?? dt : dt,
    preset, basis: (sp.get('basis') as Basis) || 'created', compare: sp.get('compare') === 'previous',
    converted: sp.get('converted') === '1', dups: sp.get('dups') === '1',
    paid: paid === 'paid' || paid === 'organic' ? paid : undefined, lists, flags,
  };
}

function serialize(f: FilterState): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set('preset', f.preset);
  if (f.preset === 'custom') { sp.set('from', f.from); sp.set('to', f.to); }
  if (f.basis !== 'created') sp.set('basis', f.basis);
  if (f.compare) sp.set('compare', 'previous');
  if (f.converted) sp.set('converted', '1');
  if (f.dups) sp.set('dups', '1');
  if (f.paid) sp.set('paid', f.paid);
  for (const [k, v] of Object.entries(f.lists)) if (v?.length) sp.set(k, v.join(','));
  for (const [k, v] of Object.entries(f.flags)) if (v) sp.set(k, v);
  return sp;
}

/** Query params for the API (everything the filter parser understands) */
export function toApiParams(f: FilterState): Record<string, string> {
  const o: Record<string, string> = { from: f.from, to: f.to, basis: f.basis, compare: f.compare ? 'previous' : 'none' };
  if (f.converted) o.converted = '1';
  if (f.dups) o.dups = '1';
  if (f.paid) o.paid = f.paid;
  for (const [k, v] of Object.entries(f.lists)) if (v?.length) o[k] = v.join(',');
  for (const [k, v] of Object.entries(f.flags)) if (v) o[k] = v;
  return o;
}

export function useFilters() {
  const [sp, setSp] = useSearchParams();

  // sticky: restore the last filter set when arriving with a bare URL
  useEffect(() => {
    if ([...sp.keys()].length === 0) {
      try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) setSp(new URLSearchParams(saved), { replace: true }); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const f = useMemo(() => parse(sp), [sp]);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, serialize(f).toString()); } catch { /* ignore */ } }, [f]);

  const set = useCallback((patch: Partial<FilterState> | ((prev: FilterState) => FilterState)) => {
    setSp((prev) => {
      const cur = parse(prev);
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      return serialize(next);
    }, { replace: false });
  }, [setSp]);

  const setList = useCallback((dim: ListDim, values: string[]) => set((p) => ({ ...p, lists: { ...p.lists, [dim]: values.length ? values : undefined } })), [set]);
  /** cross-filter: clicking a chart bar toggles that value */
  const toggleValue = useCallback((dim: ListDim, value: string) => set((p) => {
    const cur = p.lists[dim] ?? [];
    const nxt = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    return { ...p, lists: { ...p.lists, [dim]: nxt.length ? nxt : undefined } };
  }), [set]);
  const clearAll = useCallback(() => set((p) => ({ ...p, lists: {}, flags: {}, paid: undefined, converted: false })), [set]);

  const params = useMemo(() => toApiParams(f), [f]);
  const activeCount = Object.values(f.lists).filter((v) => v?.length).length + Object.values(f.flags).filter(Boolean).length + (f.paid ? 1 : 0) + (f.converted ? 1 : 0);
  return { f, set, setList, toggleValue, clearAll, params, activeCount };
}
