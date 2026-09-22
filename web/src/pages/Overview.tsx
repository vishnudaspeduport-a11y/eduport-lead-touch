import { useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmt2, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { HBars, VBars } from '../charts';
import { Icon, Note, PageHeader, Popover, Segmented, Skeleton } from '../components/ui';

interface DimRow { key: string; touches: number; leads: number; converted: number; converted_attr: number; revenue: number; conv_rate?: number | null }
interface OverviewResponse {
  period: { from: string; to: string };
  kpis: { touches: number; leads: number; converted: number; converted_in_window: number; converted_attr: number; sf_converted: number; touches_of_converted: number; revenue: number; conv_rate: number | null; touches_per_lead: number | null; touches_per_converted_lead: number | null; avg_pre_touches_converted: number | null; avg_all_touches_converted: number | null };
  stages: { key: string; leads: number; converted: number }[];
  ic_status: { key: string; leads: number; ics: number }[];
  touch_point: DimRow[]; source: DimRow[]; class_raw: DimRow[]; reason: DimRow[]; medium: DimRow[]; campaign: DimRow[]; staff: DimRow[];
  daily: { d: string; touches: number; leads: number; converted: number }[];
  definitions: Record<string, string>;
}

const DIM_COLS: Col<DimRow>[] = [
  { key: 'key', header: '' }, { key: 'touches', header: 'Total lead touches', bar: true }, { key: 'leads', header: 'Total leads' },
  { key: 'converted', header: 'Converted' }, { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) }, { key: 'revenue', header: 'Revenue (linear)', render: (v) => fmtINR(v as number) },
];

function Kpi({ title, value, sub, def }: { title: string; value: string; sub?: string; def?: string }) {
  return (
    <div className="card flex min-h-[64px] flex-col justify-between gap-0.5">
      <div className="flex items-start justify-between gap-1">
        <div className="truncate text-[10px] font-medium uppercase tracking-wide text-ink-3" title={title}>{title}</div>
        {def && <Popover align="right" width="w-80" trigger={<button className="rounded p-0.5 text-ink-3 hover:text-ink"><Icon.Help /></button>}><div className="text-xs leading-relaxed text-ink-2">{def}</div></Popover>}
      </div>
      <div className="text-lg font-semibold leading-tight tabular-nums">{value}</div>
      {sub && <div className="truncate text-[10px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Tableau-style Overview: touch-date grain. */
export default function Overview() {
  const { f, params, toggleValue } = useFilters();
  const q = useApi<OverviewResponse>('/overview', params);
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};
  const [convMode, setConvMode] = useState<'converted' | 'converted_attr'>('converted');

  const dimCard = (title: string, rows: DimRow[] | undefined, dim: ListDim, opts: { asTable?: boolean; height?: number; limit?: number; help?: string } = {}) => {
    const data = (rows ?? []).slice(0, opts.limit ?? 12);
    const selected = f.lists[dim] ?? [];
    return (
      <ChartCard title={title} subtitle={rows ? `${fmtInt(rows.reduce((s, r) => s + r.touches, 0))} touches · click to filter` : undefined}
        loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows ?? []} columns={DIM_COLS} height={opts.height ?? 250}
        help={opts.help ?? `${title}: touches in the window grouped by this value. Total leads = distinct leads touched, Converted = ${def.dim_converted ?? ''}`}>
        {opts.asTable
          ? <DataTable rows={data} compact initialSort={{ id: 'touches', desc: true }} onRowClick={(r) => toggleValue(dim, r.key === '(null)' ? '(null)' : r.key)} columns={DIM_COLS} />
          : <HBars data={data.map((r) => ({ key: r.key, value: r.touches, secondary: r[convMode], selected: selected.includes(r.key), extra: { 'Total leads': fmtInt(r.leads), 'Conv %': fmtPct(r.conv_rate) } }))}
              valueLabel="Total lead touches" secondaryLabel={convMode === 'converted' ? 'Converted' : 'Converted (attributable)'} secondaryFormat={fmtInt} onClick={(key) => toggleValue(dim, key)} />}
      </ChartCard>
    );
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Overview" subtitle={`touch date ${f.from} → ${f.to} · touch grain, like the Tableau workbook`}
        right={<Segmented size="xs" value={convMode} onChange={setConvMode} options={[{ value: 'converted', label: 'Converted = any payment' }, { value: 'converted_attr', label: 'Converted = after a touch' }]} />} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-8">
        {q.isLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        {k && <>
          <Kpi title="Total leads" value={fmtInt(k.leads)} sub="distinct leads touched" def={def.leads} />
          <Kpi title="Total lead touches" value={fmtInt(k.touches)} sub={`${fmt2(k.touches_per_lead)} per lead`} def={def.touches} />
          <Kpi title="Total converted" value={fmtInt(k.converted)} sub={`${fmtPct(k.conv_rate)} of touched leads`} def={def.converted} />
          <Kpi title="Converted after a touch" value={fmtInt(k.converted_attr)} sub={`${fmtInt(k.converted - k.converted_attr)} paid before any touch`} def={def.converted_attr} />
          <Kpi title="Converted in window" value={fmtInt(k.converted_in_window)} sub="first payment inside window" def={def.converted_in_window} />
          <Kpi title="Avg touches before conversion" value={fmt2(k.avg_pre_touches_converted)} sub="per converted lead, all time" def={def.avg_pre_touches_converted} />
          <Kpi title="Avg touches (converted, window)" value={fmt2(k.touches_per_converted_lead)} sub={`${fmtInt(k.touches_of_converted)} touches`} def={def.touches_per_converted_lead} />
          <Kpi title="SF Is_Converted flag" value={fmtInt(k.sf_converted)} sub="reference only" def={def.sf_converted} />
        </>}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Lead funnel · LM stage" subtitle="distinct touched leads by current stage · click to filter" loading={q.isLoading} error={q.error} rows={d?.stages ?? []} height={230}
          help="Current Lead_Stage__c of the distinct leads that have a touch in the window.">
          <HBars data={(d?.stages ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.converted, selected: (f.lists.lead_stage ?? []).includes(s.key) }))} valueLabel="Total leads" secondaryLabel="Converted" secondaryFormat={fmtInt} onClick={(key) => toggleValue('lead_stage', key)} />
        </ChartCard>
        <ChartCard title="Lead funnel · IC status" subtitle="interested courses of the touched leads" loading={q.isLoading} error={q.error} rows={d?.ic_status ?? []} height={230}
          help="Interested_Course__c.Status__c for the leads touched in the window. Total leads = distinct leads with an IC in that status; a lead with several ICs appears under each status.">
          <HBars data={(d?.ic_status ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.ics, extra: {} }))} valueLabel="Total leads" secondaryLabel="ICs" secondaryFormat={fmtInt} />
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {dimCard('Touch point analysis', d?.touch_point, 'touch_point')}
        {dimCard('Lead source distribution (touch source)', d?.source, 'source')}
        {dimCard('Class (raw Class__c)', d?.class_raw, 'class_raw', { limit: 14, height: 280 })}
        {dimCard('Reason (LM_Reason__c)', d?.reason, 'lm_reason', { limit: 14, height: 280 })}
        {dimCard('Medium', d?.medium, 'medium', { asTable: true, height: 300, limit: 30 })}
        {dimCard('Campaign name', d?.campaign, 'campaign', { asTable: true, height: 300, limit: 30 })}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {dimCard('Staff-wise', d?.staff, 'staff', { asTable: true, height: 320, limit: 40 })}
        <ChartCard title="Touches per day" subtitle="touches, distinct leads and converted leads by touch date" loading={q.isLoading} error={q.error} rows={d?.daily ?? []} height={320}>
          <VBars data={(d?.daily ?? []).map((r) => ({ d: r.d.slice(5), touches: r.touches, leads: r.leads }))} xKey="d" bars={[{ key: 'touches', label: 'Touches' }, { key: 'leads', label: 'Leads' }]} />
        </ChartCard>
      </div>

      <Note>Every table has a chart/table toggle and CSV download (icons top-right of each card). Filters at the top apply to all cards; the date range is the <b>touch date</b> on this page. "Converted" follows the payment definition from the brief; use the switch at the top right to see only conversions that happened after a touch. The Salesforce flag count is shown for reference so the three figures can be compared with the workbook.</Note>
    </div>
  );
}
