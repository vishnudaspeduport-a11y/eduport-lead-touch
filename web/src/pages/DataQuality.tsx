import { useState } from 'react';
import { useApi } from '../lib/api';
import type { DqResponse, DqRowsResponse } from '../lib/types';
import { fmtInt, fmtPct, toCsv, downloadText } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ChartCard } from '../components/ChartCard';
import { Icon, Note, PageHeader, Skeleton } from '../components/ui';
import { LeadDrawer } from '../components/LeadDrawer';
import { STATUS } from '../lib/palette';

const SEVERITY: Record<string, (pct: number) => 'good' | 'warning' | 'serious' | 'critical'> = {
  default: (p) => (p < 1 ? 'good' : p < 5 ? 'warning' : p < 20 ? 'serious' : 'critical'),
  leads_no_touches: (p) => (p < 30 ? 'good' : p < 60 ? 'warning' : 'serious'),
  unmapped_class: (p) => (p < 5 ? 'good' : p < 15 ? 'warning' : 'serious'),
  flagged_duplicates: (p) => (p < 3 ? 'good' : p < 8 ? 'warning' : 'serious'),
};

export default function DataQuality() {
  const q = useApi<DqResponse>('/data-quality', {}, { staleTime: 5 * 60_000 });
  const [check, setCheck] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const rows = useApi<DqRowsResponse>(`/data-quality/${check}`, { page, limit: 50 }, { enabled: !!check });
  const [open, setOpen] = useState<string | null>(null);
  const checks = q.data?.data.checks ?? [];
  const r = rows.data?.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Data quality" subtitle="How much of the data can you trust? Counts are for the whole replicated dataset; click a check to see the rows." />
      <Note>{q.data?.data.note} Severity thresholds are heuristics (see the colour key: ● good · ● watch · ● serious · ● critical).</Note>
      {q.isLoading && <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        {checks.map((c) => {
          const sev = (SEVERITY[c.check_key] ?? SEVERITY.default)(c.pct ?? 0);
          const icon = sev === 'good' ? '✓' : sev === 'warning' ? '!' : sev === 'serious' ? '!!' : '✕';
          return (
            <button key={c.check_key} className={`card text-left hover:border-accent ${check === c.check_key ? 'border-accent' : ''}`} onClick={() => { setCheck(c.check_key); setPage(1); }}>
              <div className="flex items-center gap-2 text-xs text-ink-2"><span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: STATUS[sev] }}>{icon}</span>{c.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{fmtInt(c.bad_rows)}</div>
              <div className="text-[11px] text-ink-3">{fmtPct(c.pct)} of {fmtInt(c.total_rows)}</div>
            </button>
          );
        })}
      </div>

      {check && (
        <ChartCard title={checks.find((c) => c.check_key === check)?.label ?? check} subtitle={r ? `${fmtInt(r.total)} rows · page ${r.page} of ${Math.max(1, Math.ceil(r.total / r.limit))}` : undefined} loading={rows.isLoading} error={rows.error} onRetry={rows.refetch} rows={r?.rows ?? []} height={520}
          help={`Rows from analytics.dq_${check}. Rows with a lead_id open the lead drawer. Phone keys are masked for viewers.`}
          actions={<>
            <button className="btn" disabled={!r?.rows.length} onClick={() => downloadText(`dq_${check}_p${page}.csv`, toCsv(r?.rows ?? []))}><Icon.Download /> CSV (page)</button>
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button><button className="btn" disabled={!r || page * r.limit >= r.total} onClick={() => setPage((p) => p + 1)}>›</button>
          </>}>
          <DataTable rows={r?.rows ?? []} compact onRowClick={(row) => { if (row.lead_id) setOpen(String(row.lead_id)); }} />
        </ChartCard>
      )}
      <Note>
        <b>What each check means:</b> leads with no touches (coverage of Lead_Touch__c); orphan touches (Lead_Master__c null / missing / deleted - excluded from every metric); phones that fail to normalise (cannot match payments → can never count as converted); paying app users with bad phones; valid payments with no lead; flagged duplicates and phone collisions (same phone on several non-duplicate leads → one payment converts all of them); Touch_Count__c vs actual touches (Salesforce rollup drift); payment before first touch / before lead creation (pre-existing customers, inflate conversion); Is_Converted__c vs the payment definition (which system is right?); blank touch attributes; class values that fall into Unknown / Other.
      </Note>
      {open && <LeadDrawer leadId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
