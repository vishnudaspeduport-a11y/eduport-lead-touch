import { useApi } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { FunnelResponse } from '../lib/types';
import { fmt1, fmt2, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { HBars, VBars } from '../charts';
import { Note, PageHeader } from '../components/ui';

export default function FunnelStage() {
  const { f, params, toggleValue } = useFilters();
  const q = useApi<FunnelResponse>('/funnel', params);
  const d = q.data?.data;
  const leak = d?.discount_leakage;
  return (
    <div className="space-y-3">
      <PageHeader title="Funnel & stage" subtitle="Lead stages, interested-course status, fees offered vs realised, and why leads drop off" />

      <div className="grid gap-3 xl:grid-cols-3">
        <ChartCard title="Lead stage distribution" subtitle="click to filter" loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={d?.stages ?? []} height={210}
          help="Lead_Stage__c snapshot for the leads in the window. Conv % = payment-based conversion of leads currently in that stage (a lead in 'Not Willing Now' with a valid payment still counts as converted - that is a data-quality signal, see the Data quality page).">
          <HBars data={(d?.stages ?? []).map((s) => ({ key: s.stage, value: s.leads, secondary: s.conv_rate, selected: (f.lists.lead_stage ?? []).includes(s.stage), extra: { 'Open leads': fmtInt(s.open_leads), 'Avg touches': fmt2(s.avg_touches) } }))} valueLabel="Leads" secondaryLabel="Conv %" onClick={(k) => toggleValue('lead_stage', k)} />
        </ChartCard>

        <ChartCard title="Stage → conversion rate" loading={q.isLoading} error={q.error} rows={d?.stages ?? []} height={210} help="Same stages, y = conversion %.">
          <VBars data={(d?.stages ?? []).map((s) => ({ stage: s.stage, conv: s.conv_rate ?? 0 }))} xKey="stage" bars={[{ key: 'conv', label: 'Conv %' }]} format={(v) => fmtPct(v)} onClick={(k) => toggleValue('lead_stage', k)} />
        </ChartCard>

        <ChartCard title="Time in stage (approx.)" loading={q.isLoading} error={q.error} rows={d?.time_in_stage ?? []} height={210}
          help={d?.notes[0]}>
          <DataTable rows={d?.time_in_stage ?? []} compact columns={[{ key: 'stage', header: 'Current stage' }, { key: 'leads', header: 'Leads' }, { key: 'median_days', header: 'Median days', render: (v) => fmt1(v as number), bar: true }, { key: 'avg_days', header: 'Avg days', render: (v) => fmt1(v as number) }]} />
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Interested course status funnel" subtitle="Interested_Course__c.Status__c · one lead can have several ICs" loading={q.isLoading} error={q.error} rows={d?.ic_status ?? []} height={210}
          help="ICs of the leads in the window grouped by Status__c: number of ICs, distinct leads, ICs flagged Is_Enrolled__c, total Fees_Offered__c and the distinct leads that actually converted (payment-based). Click a status to filter by best IC status.">
          <DataTable rows={d?.ic_status ?? []} compact initialSort={{ id: 'ics', desc: true }} onRowClick={(r) => toggleValue('ic_status', r.status)} columns={[
            { key: 'status', header: 'IC status' }, { key: 'ics', header: 'ICs', bar: true }, { key: 'leads', header: 'Leads' }, { key: 'enrolled', header: 'Is_Enrolled' },
            { key: 'converted_leads', header: 'Converted leads' }, { key: 'fees_offered', header: 'Fees offered', render: (v) => fmtINR(v as number) }]} />
        </ChartCard>

        <ChartCard title="Discount leakage" subtitle="converted leads with an IC" loading={q.isLoading} error={q.error} rows={leak ? [leak as unknown as Record<string, unknown>] : []} height={210} help={d?.notes[1]}>
          <div className="grid h-full grid-cols-2 content-start gap-3 text-sm">
            {leak && [['Converted leads with IC', fmtInt(leak.leads)], ['…with a fee offered', fmtInt(leak.leads_with_offer)], ['Fees offered (max per lead)', fmtINR(leak.offered)], ['Realised (valid payments)', fmtINR(leak.realized)], ['Leakage', fmtINR(leak.leakage)], ['Leakage %', fmtPct(leak.leakage_pct)]].map(([k, v]) => (
              <div key={k} className="rounded border border-line p-2"><div className="text-[11px] text-ink-3">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <ChartCard title="IC count vs conversion" loading={q.isLoading} error={q.error} rows={d?.ic_count ?? []} height={230} help="Leads bucketed by IC_Count__c; y = conversion %. More interested courses usually means more engagement - check whether it converts.">
          <VBars data={(d?.ic_count ?? []).map((r) => ({ bucket: r.ic_bucket, conv: r.conv_rate ?? 0, leads: r.leads }))} xKey="bucket" bars={[{ key: 'conv', label: 'Conv %' }]} format={(v) => fmtPct(v)} />
        </ChartCard>
        <ChartCard title="Drop-off reasons: LM_Reason__c" subtitle="click to filter" loading={q.isLoading} error={q.error} rows={d?.lm_reasons ?? []} height={230} help="Lead_Master__c.LM_Reason__c grouped; converted = leads with that reason that still paid.">
          <HBars data={(d?.lm_reasons ?? []).slice(0, 15).map((r) => ({ key: r.reason, value: r.leads, secondary: r.leads ? Math.round((r.converted / r.leads) * 10000) / 100 : null }))} valueLabel="Leads" secondaryLabel="Conv %" onClick={(k) => toggleValue('lm_reason', k === '(none)' ? '(null)' : k)} />
        </ChartCard>
        <ChartCard title="Drop-off reasons: last Task reason" loading={q.isLoading} error={q.error} rows={d?.task_reasons ?? []} height={230} help="Most recent Task.Reason__c per lead (tasks joined on the normalised phone).">
          <HBars data={(d?.task_reasons ?? []).slice(0, 15).map((r) => ({ key: r.reason, value: r.leads, secondary: r.leads ? Math.round((r.converted / r.leads) * 10000) / 100 : null }))} valueLabel="Leads" secondaryLabel="Conv %" />
        </ChartCard>
      </div>
      <Note>{d?.notes.map((n, i) => <div key={i}>• {n}</div>)}</Note>
    </div>
  );
}
