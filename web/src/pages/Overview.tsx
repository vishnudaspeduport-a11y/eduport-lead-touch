import type { ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmt2, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { HBars, VBars } from '../charts';
import { Icon, Note, PageHeader, Popover, Skeleton } from '../components/ui';

interface DimRow { key: string; touches: number; leads: number; converted: number; converted_first: number; revenue: number; conv_rate?: number | null }
interface OverviewResponse {
  period: { from: string; to: string };
  kpis: {
    touches: number; leads: number; converted: number; converted_first: number; converted_in_window: number; sf_converted: number; touches_of_converted: number; revenue: number;
    conv_rate: number | null; touches_per_lead: number | null;
    avg_touches_alltime: number | null; avg_touches_alltime_per_lead: number | null; avg_touches_alltime_n: number;
    avg_touches_window: number | null; avg_touches_window_per_lead: number | null; avg_touches_window_n: number;
  };
  stages: { key: string; leads: number; converted: number }[];
  ic_status: { key: string; leads: number; ics: number }[];
  touch_point: DimRow[]; source: DimRow[]; class_raw: DimRow[]; reason: DimRow[]; medium: DimRow[]; campaign: DimRow[]; staff: DimRow[];
  daily: { d: string; touches: number; leads: number; converted: number }[];
  definitions: Record<string, string>;
}

type Measure = 'touches' | 'leads' | 'converted';
const MEASURE_LABEL: Record<Measure, string> = { touches: 'Total lead touches', leads: 'Total leads', converted: 'Converted' };

const ALL_COLS: Col<DimRow>[] = [
  { key: 'key', header: '' }, { key: 'leads', header: 'Total leads' }, { key: 'touches', header: 'Total lead touches', bar: true },
  { key: 'converted', header: 'Converted' }, { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) },
  { key: 'converted_first', header: 'Converted (first payment)' }, { key: 'revenue', header: 'Revenue (linear)', render: (v) => fmtINR(v as number) },
];

/** Colourful KPI tile: tinted card, solid icon disc, big number */
function Kpi({ title, value, sub, def, tone, icon, small }: { title: string; value: string; sub?: string; def?: string; tone: string; icon: ReactNode; small?: boolean }) {
  return (
    <div className={`card ${tone} relative flex flex-col justify-between gap-1 overflow-hidden ${small ? 'min-h-[64px] !p-2.5' : 'min-h-[92px]'}`}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-tone opacity-70" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`grid shrink-0 place-items-center rounded-full bg-tone-solid text-white shadow ${small ? 'h-6 w-6' : 'h-8 w-8'}`}>{icon}</span>
          <div className="line-clamp-2 text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink-3" title={title}>{title}</div>
        </div>
        {def && <Popover align="right" width="w-80" trigger={<button className="relative rounded p-0.5 text-ink-3 hover:text-ink"><Icon.Help /></button>}><div className="text-xs leading-relaxed text-ink-2">{def}</div></Popover>}
      </div>
      <div>
        <div className={`font-extrabold leading-none tabular-nums tracking-tight ${small ? 'text-lg' : 'text-2xl'}`}>{value}</div>
        {sub && <div className="mt-1 truncate text-[10px] text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}

/** Mirrors the Tableau "Lead Touch - Overview" dashboard: touch-date window, touch grain. */
export default function Overview() {
  const { f, params, toggleValue } = useFilters();
  const q = useApi<OverviewResponse>('/overview', params);
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};

  const dimCard = (title: string, rows: DimRow[] | undefined, dim: ListDim, measures: [Measure, Measure?], tone: string, opts: { asTable?: boolean; height?: number; limit?: number; help?: string; subtitle?: string; colorful?: boolean } = {}) => {
    const data = (rows ?? []).slice(0, opts.limit ?? 12);
    const selected = f.lists[dim] ?? [];
    const [m1, m2] = measures;
    const cols = ALL_COLS.filter((c) => c.key === 'key' || measures.includes(c.key as Measure) || c.key === 'conv_rate');
    return (
      <ChartCard title={title} tone={tone} subtitle={opts.subtitle ?? (rows ? `${fmtInt(rows.reduce((s, r) => s + r[m1], 0))} ${MEASURE_LABEL[m1].toLowerCase()} · click a row to filter` : undefined)}
        loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows ?? []} columns={ALL_COLS} height={opts.height ?? 250}
        help={opts.help ?? `${title}: touches in the window grouped by this value. ${def.dim_converted ?? ''}`}>
        {opts.asTable
          ? <DataTable rows={data} compact initialSort={{ id: m1, desc: true }} onRowClick={(r) => toggleValue(dim, r.key)} columns={cols} />
          : <HBars colorful={opts.colorful} data={data.map((r) => ({ key: r.key, value: r[m1], secondary: m2 ? r[m2] : null, selected: selected.includes(r.key), extra: { 'Total leads': fmtInt(r.leads), 'Conv %': fmtPct(r.conv_rate) } }))}
              valueLabel={MEASURE_LABEL[m1]} secondaryLabel={m2 ? MEASURE_LABEL[m2] : undefined} secondaryFormat={fmtInt} onClick={(key) => toggleValue(dim, key)} />}
      </ChartCard>
    );
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Overview" subtitle={`touch date ${f.from} → ${f.to} · same definitions as the Tableau "Lead Touch - Overview" dashboard`} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {q.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
        {k && <>
          <Kpi tone="tone-blue" icon={<Icon.Users />} title="Total leads" value={fmtInt(k.leads)} sub="distinct leads touched in the window" def={def.leads} />
          <Kpi tone="tone-teal" icon={<Icon.Touch />} title="Total lead touches" value={fmtInt(k.touches)} sub={`${fmt2(k.touches_per_lead)} touches per lead`} def={def.touches} />
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Total converted" value={fmtInt(k.converted)} sub={`${fmtPct(k.conv_rate)} of touched leads · paid on/after a touch`} def={def.converted} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title="Avg touches before conversion" value={fmt2(k.avg_touches_alltime)} sub={`all time · ${fmt2(k.avg_touches_alltime_per_lead)} per lead (${fmtInt(k.avg_touches_alltime_n)} leads)`} def={`${def.avg_touches_alltime} ${def.avg_per_lead}`} />
          <Kpi tone="tone-green" icon={<Icon.Calendar />} title="Avg touches before conversion (date-wise)" value={fmt2(k.avg_touches_window)} sub={`in window · ${fmt2(k.avg_touches_window_per_lead)} per lead (${fmtInt(k.avg_touches_window_n)} leads)`} def={`${def.avg_touches_window} ${def.avg_per_lead}`} />
        </>}
      </div>
      {k && (
        <div className="grid grid-cols-3 gap-3">
          <Kpi small tone="tone-pink" icon={<Icon.Check />} title="Converted · first payment after a touch" value={fmtInt(k.converted_first)} sub="brief definition (earliest valid payment)" def={def.converted_first} />
          <Kpi small tone="tone-amber" icon={<Icon.Calendar />} title="Converted · first payment inside window" value={fmtInt(k.converted_in_window)} sub="new customers in the period" def={def.converted_in_window} />
          <Kpi small tone="tone-slate" icon={<Icon.Spark />} title="Salesforce Is_Converted flag" value={fmtInt(k.sf_converted)} sub="reference only" def={def.sf_converted} />
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Lead funnel · LM stage" tone="tone-blue" subtitle="Total leads by current Lead Stage · click to filter" loading={q.isLoading} error={q.error} rows={d?.stages ?? []} height={230}
          help="Current Lead_Stage__c of the distinct leads that have a touch in the window (Tableau sheet 'LM-Stage').">
          <HBars colorful data={(d?.stages ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.converted, selected: (f.lists.lead_stage ?? []).includes(s.key) }))} valueLabel="Total leads" secondaryLabel="Converted" secondaryFormat={fmtInt} onClick={(key) => toggleValue('lead_stage', key)} />
        </ChartCard>
        <ChartCard title="Lead funnel · IC status" tone="tone-pink" subtitle="Total leads by Interested Course status" loading={q.isLoading} error={q.error} rows={d?.ic_status ?? []} height={230}
          help="Interested_Course__c.Status__c for the leads touched in the window, blank status excluded (Tableau sheet 'IC Status'). A lead with several ICs appears under each status.">
          <HBars colorful data={(d?.ic_status ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.ics }))} valueLabel="Total leads" secondaryLabel="Interested courses" secondaryFormat={fmtInt} />
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {dimCard('Touch point analysis (converted leads)', d?.touch_point, 'touch_point', ['touches', 'converted'], 'tone-teal', { colorful: true })}
        {dimCard('Lead source distribution', d?.source, 'source', ['touches', 'converted'], 'tone-orange', { asTable: true, height: 250, limit: 40, help: 'Touch Source__c: total lead touches, converted leads and total leads (Tableau sheet "Lead source distribution").' })}
        {dimCard('Class (converted lead touches)', d?.class_raw, 'class_raw', ['touches', 'converted'], 'tone-violet', { limit: 14, height: 300, colorful: true })}
        {dimCard('Reason', d?.reason, 'lm_reason', ['leads'], 'tone-amber', { limit: 14, height: 300, help: def.reason, subtitle: 'Total leads by LM reason · see the help icon for the deviation from Tableau' })}
        {dimCard('Medium', d?.medium, 'medium', ['leads', 'converted'], 'tone-green', { asTable: true, height: 300, limit: 40 })}
        {dimCard('Campaign name', d?.campaign, 'campaign', ['leads', 'touches'], 'tone-blue', { asTable: true, height: 300, limit: 40 })}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {dimCard('Staff-wise', d?.staff, 'staff', ['leads', 'touches'], 'tone-pink', { asTable: true, height: 320, limit: 40 })}
        <ChartCard title="Touches per day" tone="tone-teal" subtitle="touches and distinct leads by touch date" loading={q.isLoading} error={q.error} rows={d?.daily ?? []} height={320}>
          <VBars data={(d?.daily ?? []).map((r) => ({ d: r.d.slice(5), touches: r.touches, leads: r.leads }))} xKey="d" bars={[{ key: 'touches', label: 'Touches' }, { key: 'leads', label: 'Leads' }]} />
        </ChartCard>
      </div>

      <Note>The date range is the <b>touch date</b>, as in the workbook. Filters on top apply to every card; the Class Group and Medium filters correspond to the two Tableau filters. Every card has a chart/table toggle and CSV download; tables also show Conv % (converted ÷ total leads). Hover the help icon on a card or KPI for the exact definition and any deviation from Tableau.</Note>
    </div>
  );
}
