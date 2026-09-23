import { useEffect, useState } from 'react';
import { useApi, downloadWithAuth, type Params } from '../lib/api';
import { useFilters, DIM_LABEL, type ListDim } from '../lib/filters';
import { fmtDateTime, fmtInt, fmtINR } from '../lib/format';
import { DataTable, type Col } from './DataTable';
import { LeadDrawer } from './LeadDrawer';
import { ErrorNote, Icon, Skeleton, useDebounce } from './ui';

export type DrillMetric = 'leads' | 'touches' | 'converted' | 'first_touch' | 'last_touch' | 'converted_first' | 'converted_in_window' | 'sf_converted' | 'avg_alltime' | 'avg_window';
export interface Drill { metric: DrillMetric; title: string; subtitle?: string; dim?: string; value?: string }

const METRIC_LABEL: Record<DrillMetric, string> = {
  leads: 'leads touched in the window', touches: 'leads touched in the window (with their touch counts)', converted: 'converted leads (valid payment on/after a touch)', first_touch: 'converted leads whose selected first touch is in the selection', last_touch: 'leads whose last valid touch (latest touch on/before their last payment) is in the selection',
  converted_first: 'leads whose first payment came after a touch', converted_in_window: 'leads whose first payment falls inside the window',
  sf_converted: 'leads flagged Is_Converted__c in Salesforce', avg_alltime: 'leads with a valid payment (all touches, no date filter)', avg_window: 'leads with a valid payment touched in the window',
};

type Row = Record<string, unknown>;
interface Resp { page: number; limit: number; total: number; rows: Row[]; masked: boolean; columns: string[] }

const yesNo = (v: unknown) => (v ? 'Yes' : 'No');
const COLS: Col<Row>[] = [
  { key: 'lead_name', header: 'Lead ID' },
  { key: 'eps_id', header: 'EPS ID', render: (v) => (v == null ? '–' : String(v)) },
  { key: 'first_name', header: 'Name', render: (v, r) => `${v ?? ''} ${r.last_name ?? ''}`.trim() || '–' },
  { key: 'mobile', header: 'Phone' },
  { key: 'lead_stage', header: 'Stage' },
  { key: 'class_raw', header: 'Class' },
  { key: 'lead_source', header: 'Lead source' },
  { key: 'lead_created_date', header: 'Created' },
  { key: 'touches_in_window', header: 'Touches (window)', align: 'right' },
  { key: 'n_touches_all', header: 'Touches (all)', align: 'right' },
  { key: 'touch_points', header: 'Touch points' },
  { key: 'first_touch_point', header: 'First touch (Tableau)' },
  { key: 'last_touch_point', header: 'Last valid touch' },
  { key: 'last_touch_in_window', header: 'Last touch', render: (v) => fmtDateTime(v as string) },
  { key: 'tab_converted', header: 'Converted', render: yesNo },
  { key: 'converted_at', header: 'First payment' },
  { key: 'last_payment_date', header: 'Last payment' },
  { key: 'revenue', header: 'Revenue', render: (v) => fmtINR(v as number) },
  { key: 'courses', header: 'Course / batch' },
  { key: 'owner_name', header: 'Owner' },
  { key: 'district', header: 'District' },
  { key: 'lm_reason', header: 'LM reason' },
  { key: 'best_ic_status', header: 'IC status' },
  { key: 'sf_is_converted', header: 'SF converted', render: yesNo },
  { key: 'is_duplicate', header: 'Duplicate', render: yesNo },
  { key: 'email', header: 'Email' },
  { key: 'lead_id', header: 'Salesforce Id' },
];

/** Slide-over listing every lead behind a KPI / bar / slice / table row of the Overview. Click a row for the full lead record. */
export function DrillDrawer({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const { params, toggleValue } = useFilters();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({ id: 'touches_in_window', desc: true });
  const [search, setSearch] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [dl, setDl] = useState(false);
  const q = useDebounce(search, 300);
  useEffect(() => { setPage(1); }, [q, drill.metric, drill.dim, drill.value]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !leadId) onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose, leadId]);

  const p: Params = { ...params, metric: drill.metric, dim: drill.dim, value: drill.value, q, page, limit, sort: sort.id, dir: sort.desc ? 'desc' : 'asc' };
  const r = useApi<Resp>('/overview/leads', p, { placeholderData: (prev) => prev });
  const d = r.data?.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;
  const dimLabel = drill.dim ? (DIM_LABEL[drill.dim] ?? drill.dim) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-extrabold tracking-tight">{drill.title}</h2>
              {dimLabel && <span className="chip"><b>{dimLabel}</b>: {drill.value}</span>}
              {d && <span className="text-xs text-ink-3">{fmtInt(d.total)} leads</span>}
            </div>
            <div className="text-[11px] text-ink-3">{drill.subtitle ?? METRIC_LABEL[drill.metric]} · click a row for the full lead record{d?.masked ? ' · phone and email are masked on this public site' : ''}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <input className="input w-56" placeholder="Search name, phone, LM-id…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {drill.dim && drill.value !== undefined && (
              <button className="btn" title="Apply this value as a page filter" onClick={() => { toggleValue(drill.dim as ListDim, drill.value!); onClose(); }}><Icon.Plus /> Filter page by this</button>
            )}
            <button className="btn" disabled={dl} onClick={async () => { setDl(true); try { await downloadWithAuth('/overview/leads.csv', { ...p, page: undefined, limit: undefined }, `${drill.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.csv`); } catch (e) { alert(String(e)); } finally { setDl(false); } }}>
              <Icon.Download /> {dl ? 'Preparing…' : 'CSV (all rows)'}
            </button>
            <button className="btn btn-dark" onClick={onClose}><Icon.Close /> Close</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {r.error && <ErrorNote error={r.error} onRetry={r.refetch} />}
          {!d && r.isLoading && <div className="space-y-2"><Skeleton /><Skeleton /><Skeleton className="h-64" /></div>}
          {d && (
            <div className={`h-full ${r.isFetching ? 'opacity-70' : ''}`}>
              <DataTable rows={d.rows} columns={COLS} compact maxHeight="100%" rowKey={(x) => String(x.lead_id)} onRowClick={(x) => setLeadId(String(x.lead_id))}
                initialSort={sort} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-2">
          <div className="flex items-center gap-2">
            <span>Sort</span>
            <select className="input !py-0.5" value={sort.id} onChange={(e) => setSort({ id: e.target.value, desc: sort.desc })}>
              {[['touches_in_window', 'Touches (window)'], ['n_touches_all', 'Touches (all)'], ['last_touch_in_window', 'Last touch'], ['created_date', 'Created'], ['converted_at', 'First payment'], ['last_payment_date', 'Last payment'], ['revenue', 'Revenue'], ['lead_name', 'Lead ID'], ['lead_stage', 'Stage'], ['class_raw', 'Class'], ['owner_name', 'Owner']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn" onClick={() => setSort({ ...sort, desc: !sort.desc })}>{sort.desc ? '▼ desc' : '▲ asc'}</button>
            <select className="input !py-0.5" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
            <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
            <span className="px-2 tabular-nums">page {page} / {pages}</span>
            <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
            <button className="btn" disabled={page >= pages} onClick={() => setPage(pages)}>»</button>
          </div>
        </div>
      </div>
      {leadId && <LeadDrawer leadId={leadId} onClose={() => setLeadId(null)} />}
    </div>
  );
}
