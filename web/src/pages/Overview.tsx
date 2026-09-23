import { useState, type ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmt2, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { Donut, HBars, VBars } from '../charts';
import { Icon, Note, PageHeader, Popover, Skeleton } from '../components/ui';
import { DrillDrawer, type Drill, type DrillMetric } from '../components/DrillDrawer';

interface DimRow { key: string; touches: number; leads: number; converted: number; converted_first: number; conv_rate?: number | null }
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
  { key: 'converted_first', header: 'Converted (first payment)' },
];

/** Colourful KPI tile: tinted card, solid icon disc, big number */
function Kpi({ title, value, sub, def, tone, icon, small, onClick }: { title: string; value: string; sub?: string; def?: string; tone: string; icon: ReactNode; small?: boolean; onClick?: () => void }) {
  return (
    <div className={`card ${tone} relative flex flex-col justify-between gap-1 overflow-hidden ${small ? 'min-h-[64px] !p-2.5' : 'min-h-[92px]'} ${onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-pop' : ''}`} onClick={onClick} title={onClick ? 'Click to see the leads' : undefined}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-tone opacity-70" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`grid shrink-0 place-items-center rounded-full bg-tone-solid text-white shadow ${small ? 'h-6 w-6' : 'h-8 w-8'}`}>{icon}</span>
          <div className="line-clamp-2 text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink-3" title={title}>{title}</div>
        </div>
        {def && <span onClick={(e) => e.stopPropagation()}><Popover align="right" width="w-80" trigger={<button className="relative rounded p-0.5 text-ink-3 hover:text-ink"><Icon.Help /></button>}><div className="text-xs leading-relaxed text-ink-2">{def}</div></Popover></span>}
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
  const { f, params, toggleValue, set } = useFilters();
  const q = useApi<OverviewResponse>('/overview', params);
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};
  const [drill, setDrill] = useState<Drill | null>(null);
  const open = (metric: DrillMetric, title: string, dim?: string, value?: string, subtitle?: string) => setDrill({ metric, title, dim, value, subtitle });

  const dimCard = (title: string, rows: DimRow[] | undefined, dim: ListDim, measures: [Measure, Measure?], tone: string, opts: { asTable?: boolean; height?: number; limit?: number; help?: string; subtitle?: string; colorful?: boolean } = {}) => {
    const data = (rows ?? []).slice(0, opts.limit ?? 12);
    const selected = f.lists[dim] ?? [];
    const [m1, m2] = measures;
    const cols = ALL_COLS.filter((c) => c.key === 'key' || measures.includes(c.key as Measure) || c.key === 'conv_rate');
    return (
      <ChartCard title={title} tone={tone} subtitle={opts.subtitle ?? (rows ? `${fmtInt(rows.reduce((s, r) => s + r[m1], 0))} ${MEASURE_LABEL[m1].toLowerCase()} · click a row to filter every card` : undefined)}
        loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows ?? []} columns={ALL_COLS} height={opts.height ?? 250}
        help={opts.help ?? `${title}: touches in the window grouped by this value. ${def.dim_converted ?? ''}`}>
        {opts.asTable
          ? <DataTable rows={rows ?? []} compact maxHeight="100%" initialSort={{ id: m1, desc: true }} onRowClick={(r) => toggleValue(dim, r.key)} columns={cols} />
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
          <Kpi tone="tone-blue" icon={<Icon.Users />} title="Total leads" value={fmtInt(k.leads)} sub="distinct leads touched in the window" def={def.leads} onClick={() => open('leads', 'Total leads')} />
          <Kpi tone="tone-teal" icon={<Icon.Touch />} title="Total lead touches" value={fmtInt(k.touches)} sub={`${fmt2(k.touches_per_lead)} touches per lead`} def={def.touches} onClick={() => open('touches', 'Total lead touches')} />
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Total converted" value={fmtInt(k.converted)} sub={`${fmtPct(k.conv_rate)} of touched leads · paid on/after a touch`} def={def.converted} onClick={() => open('converted', 'Total converted')} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title="Avg touches before conversion" value={fmt2(k.avg_touches_alltime)} sub={`all time · ${fmt2(k.avg_touches_alltime_per_lead)} per lead (${fmtInt(k.avg_touches_alltime_n)} leads)`} def={`${def.avg_touches_alltime} ${def.avg_per_lead}`} onClick={() => open('avg_alltime', 'Avg touches before conversion', undefined, undefined, 'converted leads with their all-time touch counts (no date filter)')} />
          <Kpi tone="tone-green" icon={<Icon.Calendar />} title="Avg touches before conversion (date-wise)" value={fmt2(k.avg_touches_window)} sub={`in window · ${fmt2(k.avg_touches_window_per_lead)} per lead (${fmtInt(k.avg_touches_window_n)} leads)`} def={`${def.avg_touches_window} ${def.avg_per_lead}`} onClick={() => open('avg_window', 'Avg touches before conversion (date-wise)', undefined, undefined, 'converted leads touched in the window, with their all-time touch counts')} />
        </>}
      </div>
      {k && (
        <div className="grid grid-cols-3 gap-3">
          <Kpi small tone="tone-pink" icon={<Icon.Check />} title="Converted · first payment after a touch" value={fmtInt(k.converted_first)} sub="brief definition (earliest valid payment)" def={def.converted_first} onClick={() => open('converted_first', 'Converted · first payment after a touch')} />
          <Kpi small tone="tone-amber" icon={<Icon.Calendar />} title="Converted · first payment inside window" value={fmtInt(k.converted_in_window)} sub="new customers in the period" def={def.converted_in_window} onClick={() => open('converted_in_window', 'Converted · first payment inside window')} />
          <Kpi small tone="tone-slate" icon={<Icon.Spark />} title="Salesforce Is_Converted flag" value={fmtInt(k.sf_converted)} sub="reference only" def={def.sf_converted} onClick={() => open('sf_converted', 'Salesforce Is_Converted flag')} />
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Lead funnel · LM stage" tone="tone-blue" subtitle="Total leads by current Lead Stage · click a slice to filter" loading={q.isLoading} error={q.error} rows={d?.stages ?? []} height={300}
          help="Current Lead_Stage__c of the distinct leads that have a touch in the window (Tableau sheet 'LM-Stage').">
          <Donut data={(d?.stages ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.converted, selected: (f.lists.lead_stage ?? []).includes(s.key) }))} valueLabel="Total leads" secondaryLabel="Converted" centerLabel="leads" onClick={(key) => toggleValue('lead_stage', key)} />
        </ChartCard>
        <ChartCard title="Lead funnel · IC status" tone="tone-pink" subtitle="Total leads by Interested Course status · click a bar to filter (IC status)" loading={q.isLoading} error={q.error} rows={d?.ic_status ?? []} height={300}
          help="Interested_Course__c.Status__c for the leads touched in the window, blank status excluded (Tableau sheet 'IC Status'). A lead with several ICs appears under each status.">
          <HBars colorful data={(d?.ic_status ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.ics }))} valueLabel="Total leads" secondaryLabel="Interested courses" secondaryFormat={fmtInt} onClick={(key) => toggleValue('ic_status', key)} />
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {dimCard('Touch point analysis (converted leads)', d?.touch_point, 'touch_point', ['touches', 'converted'], 'tone-teal', { colorful: true, height: 340 })}
        {dimCard('Lead source distribution', d?.source, 'source', ['touches', 'converted'], 'tone-orange', { asTable: true, height: 340, help: 'Touch Source__c: total lead touches, converted leads and total leads (Tableau sheet "Lead source distribution").' })}
        {dimCard('Class (converted lead touches)', d?.class_raw, 'class_raw', ['touches', 'converted'], 'tone-violet', { limit: 14, height: 380, colorful: true })}
        {dimCard('Reason', d?.reason, 'lm_reason', ['leads'], 'tone-amber', { limit: 14, height: 380, help: def.reason, subtitle: 'Total leads by LM reason · see the help icon for the deviation from Tableau' })}
        {dimCard('Medium', d?.medium, 'medium', ['leads', 'converted'], 'tone-green', { asTable: true, height: 320 })}
        {dimCard('Campaign name', d?.campaign, 'campaign', ['leads', 'touches'], 'tone-blue', { asTable: true, height: 320 })}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {dimCard('Staff-wise', d?.staff, 'staff', ['leads', 'touches'], 'tone-pink', { asTable: true, height: 340 })}
        <ChartCard title="Touches per day" tone="tone-teal" subtitle="touches and distinct leads by touch date · click a day to zoom the date range to it" loading={q.isLoading} error={q.error} rows={d?.daily ?? []} height={340}>
          <VBars data={(d?.daily ?? []).map((r) => ({ d: r.d.slice(5), full: r.d, touches: r.touches, leads: r.leads }))} xKey="d" bars={[{ key: 'touches', label: 'Touches' }, { key: 'leads', label: 'Leads' }]} onClick={(key) => { const row = (d?.daily ?? []).find((r) => r.d.slice(5) === key); if (row) set({ preset: 'custom', from: row.d, to: row.d }); }} />
        </ChartCard>
      </div>

      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
      <Note>The date range is the <b>touch date</b>, as in the workbook. Filters on top apply to every card; the Class Group and Medium filters correspond to the two Tableau filters. Click a KPI tile to list the leads behind it (with CSV download). Clicking a bar, slice or table row filters every card by that value; remove the chip on top to undo. Every card also has a chart/table toggle. Hover the help icon on a card or KPI for the exact definition and any deviation from Tableau.</Note>
    </div>
  );
}
