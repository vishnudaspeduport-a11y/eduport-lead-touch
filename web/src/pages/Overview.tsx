import { useState, type ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmt2, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { DailyLines, Donut, HBars } from '../charts';
import { CardSearch, Icon, Note, PageHeader, Skeleton } from '../components/ui';
import { KpiTile, type KpiSplit } from '../components/KpiTile';
import { DrillDrawer, type Drill, type DrillMetric } from '../components/DrillDrawer';

interface DimRow { key: string; touches: number; leads: number; converted: number; converted_first: number; conv_rate?: number | null }
interface OverviewResponse {
  period: { from: string; to: string }; payment_period: { from: string; to: string } | null; basis: 'created' | 'touch';
  kpis: {
    touches: number; leads: number; converted: number; converted_first: number; sf_converted: number; sf_flag_no_pay: number; paid_no_flag: number; touches_of_converted: number; revenue: number;
    conv_rate: number | null; touches_per_lead: number | null;
    avg_touches_alltime: number | null; avg_touches_alltime_per_lead: number | null; avg_touches_alltime_n: number;
    avg_touches_window: number | null; avg_touches_window_per_lead: number | null; avg_touches_window_n: number;
    stale_new: number; stale_new_untouched: number; new_total: number; stale_days: number;
    stale_nc: number; stale_nc_untouched: number; nc_total: number;
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
function Kpi(p: { title: string; value: string; sub?: string; def?: string; tone: string; icon: ReactNode; small?: boolean; onClick?: () => void; split?: KpiSplit[] }) { return <KpiTile {...p} />; }

type DimCardOpts = { asTable?: boolean; height?: number; limit?: number; help?: string; subtitle?: string; colorful?: boolean };

/** One dimension card (bars or table) with a search box; rows can be applied as a page filter one by one or all matches at once. */
function DimCard({ title, rows, dim, measures, tone, opts, loading, error, onRetry, def, selected, toggleValue, setList }: {
  title: string; rows: DimRow[] | undefined; dim: ListDim; measures: [Measure, Measure?]; tone: string; opts: DimCardOpts; loading: boolean; error: unknown; onRetry: () => void;
  def: Record<string, string>; selected: string[]; toggleValue: (dim: ListDim, v: string) => void; setList: (dim: ListDim, v: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const s = search.trim().toLowerCase();
  const all = rows ?? [];
  const filtered = s ? all.filter((r) => r.key.toLowerCase().includes(s)) : all;
  const data = filtered.slice(0, opts.limit ?? 12);
  const [m1, m2] = measures;
  const cols = ALL_COLS.filter((c) => c.key === 'key' || measures.includes(c.key as Measure) || c.key === 'conv_rate');
  return (
    <ChartCard title={title} tone={tone} subtitle={opts.subtitle ?? (rows ? `${fmtInt(filtered.reduce((x, r) => x + r[m1], 0))} ${MEASURE_LABEL[m1].toLowerCase()}${s ? ` in ${filtered.length} matching rows` : ''} · click a row to filter every card` : undefined)}
      loading={loading} error={error} onRetry={onRetry} rows={filtered} columns={ALL_COLS} height={opts.height ?? 250}
      actions={<CardSearch value={search} onChange={setSearch} count={filtered.length} onApply={() => setList(dim, filtered.map((r) => r.key))} />}
      help={opts.help ?? `${title}: touches in the window grouped by this value. ${def.dim_converted ?? ''}`}>
      {opts.asTable
        ? <DataTable rows={filtered} compact maxHeight="100%" initialSort={{ id: m1, desc: true }} onRowClick={(r) => toggleValue(dim, r.key)} columns={cols} />
        : <HBars colorful={opts.colorful} data={data.map((r) => ({ key: r.key, value: r[m1], secondary: m2 ? r[m2] : null, selected: selected.includes(r.key), extra: { 'Total leads': fmtInt(r.leads), 'Conv %': fmtPct(r.conv_rate) } }))}
            valueLabel={MEASURE_LABEL[m1]} secondaryLabel={m2 ? MEASURE_LABEL[m2] : undefined} secondaryFormat={fmtInt} onClick={(key) => toggleValue(dim, key)} />}
    </ChartCard>
  );
}

/** Mirrors the Tableau "Lead Touch - Overview" dashboard: touch-date window, touch grain. */
export default function Overview() {
  const { f, params, toggleValue, setList, set } = useFilters();
  const q = useApi<OverviewResponse>('/overview', params);
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};
  const [drill, setDrill] = useState<Drill | null>(null);
  const open = (metric: DrillMetric, title: string, dim?: string, value?: string, subtitle?: string) => setDrill({ metric, title, dim, value, subtitle, summary: !dim });

  const dimCard = (title: string, rows: DimRow[] | undefined, dim: ListDim, measures: [Measure, Measure?], tone: string, opts: DimCardOpts = {}) => (
    <DimCard key={title} title={title} rows={rows} dim={dim} measures={measures} tone={tone} opts={opts} loading={q.isLoading} error={q.error} onRetry={q.refetch}
      def={def} selected={f.lists[dim] ?? []} toggleValue={toggleValue} setList={setList} />
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" subtitle={`${f.basis === 'created' ? 'lead created' : 'touch date'} ${f.from} → ${f.to}${f.pay ? ` · payment date ${f.pfrom} → ${f.pto}` : ''} · same definitions as the Tableau "Lead Touch - Overview" dashboard`} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
        {q.isLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
        {k && <>
          <Kpi tone="tone-brand" icon={<Icon.Users />} title="Total leads" value={fmtInt(k.leads)} sub={f.basis === 'created' ? 'distinct leads created in the window' : 'distinct leads touched in the window'} def={`${def.leads_basis ?? ''} ${def.leads ?? ''}`} onClick={() => open('leads', 'Total leads')} />
          <Kpi tone="tone-teal" icon={<Icon.Touch />} title="Total lead touches" value={fmtInt(k.touches)} sub={`${fmt2(k.touches_per_lead)} touches per lead`} def={def.touches} onClick={() => open('touches', 'Total lead touches')} />
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Total converted" value={fmtInt(k.converted)} sub={f.pay ? `${fmtPct(k.conv_rate)} of leads · paid ${f.pfrom} → ${f.pto}` : `${fmtPct(k.conv_rate)} of leads · paid on/after a touch`} def={`${def.converted} — ${def.converted_first}`} onClick={() => open('converted', 'Total converted')}
            split={[
              { label: 'after touch', value: fmtInt(k.converted_first), title: def.converted_first, onClick: () => open('converted_first', 'Converted · first payment after a touch') },
            ]} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title="Avg touches before conversion" value={fmt2(k.avg_touches_alltime)} sub={`all time · ${fmt2(k.avg_touches_alltime_per_lead)} per lead (${fmtInt(k.avg_touches_alltime_n)} leads)`} def={`${def.avg_touches_alltime} ${def.avg_per_lead}`} onClick={() => open('avg_alltime', 'Avg touches before conversion', undefined, undefined, 'converted leads with their all-time touch counts (no date filter)')} />
          <Kpi tone="tone-green" icon={<Icon.Calendar />} title="Avg touches before conversion (date-wise)" value={fmt2(k.avg_touches_window)} sub={`in window · ${fmt2(k.avg_touches_window_per_lead)} per lead (${fmtInt(k.avg_touches_window_n)} leads)`} def={`${def.avg_touches_window} ${def.avg_per_lead}`} onClick={() => open('avg_window', 'Avg touches before conversion (date-wise)', undefined, undefined, 'converted leads touched in the window, with their all-time touch counts')} />
          <Kpi tone="tone-slate" icon={<Icon.Spark />} title="Salesforce Is_Converted flag" value={fmtInt(k.sf_converted)} sub="reference only" def={`${def.sf_converted} — ${def.sf_flag_no_pay} — ${def.paid_no_flag}`} onClick={() => open('sf_converted', 'Salesforce Is_Converted flag')}
            split={[
              { label: 'flagged, no payment', value: fmtInt(k.sf_flag_no_pay), title: def.sf_flag_no_pay, onClick: () => open('sf_flag_no_pay', 'Flagged converted in Salesforce · no payment') },
              { label: 'paid, no flag', value: fmtInt(k.paid_no_flag), title: def.paid_no_flag, onClick: () => open('paid_no_flag', 'Paid · Salesforce flag not set') },
            ]} />
          <Kpi tone="tone-red" icon={<Icon.Calendar />} title={`Still New after ${k.stale_days} days`} value={fmtInt(k.stale_new)} sub={`of ${fmtInt(k.new_total)} leads in stage New · ${fmtInt(k.stale_new_untouched)} never touched after creation`} def={def.stale_new}
            onClick={() => open('stale_new', `Still New after ${k.stale_days} days`, undefined, undefined, 'leads still in stage New, created more than 5 days ago and not touched in the last 5 days · sorted by last touch')} />
          <Kpi tone="tone-amber" icon={<Icon.Calendar />} title={`Still Not Connected after ${k.stale_days} days`} value={fmtInt(k.stale_nc)} sub={`of ${fmtInt(k.nc_total)} leads in stage Not Connected · ${fmtInt(k.stale_nc_untouched)} never touched after creation`} def={def.stale_nc}
            onClick={() => open('stale_not_connected', `Still Not Connected after ${k.stale_days} days`, undefined, undefined, 'leads still in stage Not Connected, created more than 5 days ago and not touched in the last 5 days · sorted by last touch')} />
        </>}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Lead funnel · LM stage" tone="tone-brand" subtitle="Total leads by current Lead Stage · click a slice to filter" loading={q.isLoading} error={q.error} rows={d?.stages ?? []} height={240}
          help="Current Lead_Stage__c of the distinct leads that have a touch in the window (Tableau sheet 'LM-Stage').">
          <Donut data={(d?.stages ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.converted, selected: (f.lists.lead_stage ?? []).includes(s.key) }))} valueLabel="Total leads" secondaryLabel="Converted" centerLabel="leads" onClick={(key) => toggleValue('lead_stage', key)} />
        </ChartCard>
        <ChartCard title="Lead funnel · IC status" tone="tone-pink" subtitle="Total leads by Interested Course status · click a bar to filter (IC status)" loading={q.isLoading} error={q.error} rows={d?.ic_status ?? []} height={240}
          help="Interested_Course__c.Status__c for the leads touched in the window, blank status excluded (Tableau sheet 'IC Status'). A lead with several ICs appears under each status.">
          <HBars colorful data={(d?.ic_status ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.ics }))} valueLabel="Total leads" secondaryLabel="Interested courses" secondaryFormat={fmtInt} onClick={(key) => toggleValue('ic_status', key)} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {dimCard('Touch point analysis (converted leads)', d?.touch_point, 'touch_point', ['touches', 'converted'], 'tone-teal', { colorful: true, height: 270 })}
        {dimCard('Lead source distribution', d?.source, 'source', ['touches', 'converted'], 'tone-orange', { asTable: true, height: 270, help: 'Touch Source__c: total lead touches, converted leads and total leads (Tableau sheet "Lead source distribution").' })}
        {dimCard('Class (converted lead touches)', d?.class_raw, 'class_raw', ['touches', 'converted'], 'tone-violet', { limit: 14, height: 300, colorful: true })}
        {dimCard('Reason', d?.reason, 'lm_reason', ['leads'], 'tone-amber', { limit: 14, height: 300, help: def.reason, subtitle: 'Total leads by LM reason · see the help icon for the deviation from Tableau' })}
        {dimCard('Medium', d?.medium, 'medium', ['leads', 'converted'], 'tone-green', { asTable: true, height: 260 })}
        {dimCard('Campaign name', d?.campaign, 'campaign', ['leads', 'touches'], 'tone-brand', { asTable: true, height: 260 })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {dimCard('Staff-wise', d?.staff, 'staff', ['leads', 'touches'], 'tone-pink', { asTable: true, height: 260 })}
        <ChartCard title="Touches per day" tone="tone-teal" subtitle="touches, distinct leads and converted leads by touch date · click a point to zoom the date range to that day" loading={q.isLoading} error={q.error} rows={d?.daily ?? []} height={260}>
          <DailyLines data={(d?.daily ?? []).map((r) => ({ d: r.d.slice(5), touches: r.touches, leads: r.leads, converted: r.converted }))} xKey="d" lines={[{ key: 'touches', label: 'Touches' }, { key: 'leads', label: 'Leads' }, { key: 'converted', label: 'Converted' }]} onClick={(key) => { const row = (d?.daily ?? []).find((r) => r.d.slice(5) === key); if (row) set({ preset: 'custom', from: row.d, to: row.d }); }} />
        </ChartCard>
      </div>

      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
      <Note>The main date range applies to the <b>lead created</b> date or the <b>touch date</b>, whichever is selected in the filter bar (the workbook uses touch date). Switch on <b>Payment date</b> to add a second window: Converted then counts only valid payments dated inside it. Filters on top apply to every card; the Class Group and Medium filters correspond to the two Tableau filters. Click a KPI tile to list the leads behind it (with CSV download). Clicking a bar, slice or table row filters every card by that value; remove the chip on top to undo. Every card also has a chart/table toggle. Hover the help icon on a card or KPI for the exact definition and any deviation from Tableau.</Note>
    </div>
  );
}
