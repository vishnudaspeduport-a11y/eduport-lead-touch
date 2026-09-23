import { useState, type ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmt2, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { DailyLines, Donut, HBars } from '../charts';
import { CardSearch, Icon, Note, PageHeader, Popover, Skeleton } from '../components/ui';
import { DrillDrawer, type Drill, type DrillMetric } from '../components/DrillDrawer';

interface DimRow { key: string; touches: number; leads: number; converted: number; converted_first: number; conv_rate?: number | null }
interface OverviewResponse {
  period: { from: string; to: string }; payment_period: { from: string; to: string } | null; basis: 'created' | 'touch';
  kpis: {
    touches: number; leads: number; converted: number; converted_first: number; converted_in_window: number; sf_converted: number; touches_of_converted: number; revenue: number;
    conv_rate: number | null; touches_per_lead: number | null;
    avg_touches_alltime: number | null; avg_touches_alltime_per_lead: number | null; avg_touches_alltime_n: number;
    avg_touches_window: number | null; avg_touches_window_per_lead: number | null; avg_touches_window_n: number;
    stale_new: number; stale_new_untouched: number; new_total: number; stale_days: number;
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
function Kpi({ title, value, sub, def, tone, icon, small, onClick, split }: { title: string; value: string; sub?: string; def?: string; tone: string; icon: ReactNode; small?: boolean; onClick?: () => void; split?: { label: string; value: string; onClick?: () => void; title?: string }[] }) {
  return (
    <div className={`card ${tone} relative flex flex-col justify-between gap-1 overflow-hidden !p-2.5 ${small ? 'min-h-[64px]' : 'min-h-[84px]'} ${onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-pop' : ''}`} onClick={onClick} title={onClick ? 'Click to see the leads' : undefined}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-tone opacity-70" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`grid shrink-0 place-items-center rounded-full bg-tone-solid text-white shadow ${small ? 'h-6 w-6' : 'h-7 w-7'}`}>{icon}</span>
          <div className="line-clamp-2 text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink-3" title={title}>{title}</div>
        </div>
        {def && <span onClick={(e) => e.stopPropagation()}><Popover align="right" width="w-80" trigger={<button className="relative rounded p-0.5 text-ink-3 hover:text-ink"><Icon.Help /></button>}><div className="text-xs leading-relaxed text-ink-2">{def}</div></Popover></span>}
      </div>
      <div>
        <div className={`font-extrabold leading-none tabular-nums tracking-tight ${small ? 'text-lg' : 'text-xl'}`}>{value}</div>
        {sub && <div className="mt-1 truncate text-[10px] text-ink-3">{sub}</div>}
        {split && (
          <div className="mt-1.5 grid grid-cols-2 gap-1 border-t border-line/70 pt-1.5">
            {split.map((s) => (
              <button key={s.label} title={s.title} className="rounded-lg px-1 py-0.5 text-left hover:bg-tone" onClick={(e) => { e.stopPropagation(); s.onClick?.(); }}>
                <div className="text-[9px] uppercase leading-tight tracking-wide text-ink-3">{s.label}</div>
                <div className="text-sm font-bold tabular-nums leading-tight">{s.value}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const open = (metric: DrillMetric, title: string, dim?: string, value?: string, subtitle?: string) => setDrill({ metric, title, dim, value, subtitle });

  const dimCard = (title: string, rows: DimRow[] | undefined, dim: ListDim, measures: [Measure, Measure?], tone: string, opts: DimCardOpts = {}) => (
    <DimCard key={title} title={title} rows={rows} dim={dim} measures={measures} tone={tone} opts={opts} loading={q.isLoading} error={q.error} onRetry={q.refetch}
      def={def} selected={f.lists[dim] ?? []} toggleValue={toggleValue} setList={setList} />
  );

  return (
    <div className="space-y-2">
      <PageHeader title="Overview" subtitle={`${f.basis === 'created' ? 'lead created' : 'touch date'} ${f.from} → ${f.to}${f.pay ? ` · payment date ${f.pfrom} → ${f.pto}` : ''} · same definitions as the Tableau "Lead Touch - Overview" dashboard`} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {q.isLoading && Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
        {k && <>
          <Kpi tone="tone-blue" icon={<Icon.Users />} title="Total leads" value={fmtInt(k.leads)} sub={f.basis === 'created' ? 'distinct leads created in the window' : 'distinct leads touched in the window'} def={`${def.leads_basis ?? ''} ${def.leads ?? ''}`} onClick={() => open('leads', 'Total leads')} />
          <Kpi tone="tone-teal" icon={<Icon.Touch />} title="Total lead touches" value={fmtInt(k.touches)} sub={`${fmt2(k.touches_per_lead)} touches per lead`} def={def.touches} onClick={() => open('touches', 'Total lead touches')} />
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Total converted" value={fmtInt(k.converted)} sub={f.pay ? `${fmtPct(k.conv_rate)} of leads · paid ${f.pfrom} → ${f.pto}` : `${fmtPct(k.conv_rate)} of leads · paid on/after a touch`} def={`${def.converted} — ${def.converted_first} — ${def.converted_in_window}`} onClick={() => open('converted', 'Total converted')}
            split={[
              { label: 'First payment after a touch', value: fmtInt(k.converted_first), title: def.converted_first, onClick: () => open('converted_first', 'Converted · first payment after a touch') },
              { label: f.pay ? 'New customers (payment window)' : 'New customers (in window)', value: fmtInt(k.converted_in_window), title: def.converted_in_window, onClick: () => open('converted_in_window', 'Converted · first payment inside window') },
            ]} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title="Avg touches before conversion" value={fmt2(k.avg_touches_alltime)} sub={`all time · ${fmt2(k.avg_touches_alltime_per_lead)} per lead (${fmtInt(k.avg_touches_alltime_n)} leads)`} def={`${def.avg_touches_alltime} ${def.avg_per_lead}`} onClick={() => open('avg_alltime', 'Avg touches before conversion', undefined, undefined, 'converted leads with their all-time touch counts (no date filter)')} />
          <Kpi tone="tone-green" icon={<Icon.Calendar />} title="Avg touches before conversion (date-wise)" value={fmt2(k.avg_touches_window)} sub={`in window · ${fmt2(k.avg_touches_window_per_lead)} per lead (${fmtInt(k.avg_touches_window_n)} leads)`} def={`${def.avg_touches_window} ${def.avg_per_lead}`} onClick={() => open('avg_window', 'Avg touches before conversion (date-wise)', undefined, undefined, 'converted leads touched in the window, with their all-time touch counts')} />
          <Kpi tone="tone-slate" icon={<Icon.Spark />} title="Salesforce Is_Converted flag" value={fmtInt(k.sf_converted)} sub="reference only" def={def.sf_converted} onClick={() => open('sf_converted', 'Salesforce Is_Converted flag')} />
          <Kpi tone="tone-red" icon={<Icon.Calendar />} title={`Still New after ${k.stale_days} days`} value={fmtInt(k.stale_new)} sub={`of ${fmtInt(k.new_total)} leads in stage New · ${fmtInt(k.stale_new_untouched)} never touched after creation`} def={def.stale_new}
            onClick={() => open('stale_new', `Still New after ${k.stale_days} days`, undefined, undefined, 'leads still in stage New, created more than 5 days ago and not touched in the last 5 days · sorted by last touch')} />
        </>}
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <ChartCard title="Lead funnel · LM stage" tone="tone-blue" subtitle="Total leads by current Lead Stage · click a slice to filter" loading={q.isLoading} error={q.error} rows={d?.stages ?? []} height={240}
          help="Current Lead_Stage__c of the distinct leads that have a touch in the window (Tableau sheet 'LM-Stage').">
          <Donut data={(d?.stages ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.converted, selected: (f.lists.lead_stage ?? []).includes(s.key) }))} valueLabel="Total leads" secondaryLabel="Converted" centerLabel="leads" onClick={(key) => toggleValue('lead_stage', key)} />
        </ChartCard>
        <ChartCard title="Lead funnel · IC status" tone="tone-pink" subtitle="Total leads by Interested Course status · click a bar to filter (IC status)" loading={q.isLoading} error={q.error} rows={d?.ic_status ?? []} height={240}
          help="Interested_Course__c.Status__c for the leads touched in the window, blank status excluded (Tableau sheet 'IC Status'). A lead with several ICs appears under each status.">
          <HBars colorful data={(d?.ic_status ?? []).map((s) => ({ key: s.key, value: s.leads, secondary: s.ics }))} valueLabel="Total leads" secondaryLabel="Interested courses" secondaryFormat={fmtInt} onClick={(key) => toggleValue('ic_status', key)} />
        </ChartCard>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        {dimCard('Touch point analysis (converted leads)', d?.touch_point, 'touch_point', ['touches', 'converted'], 'tone-teal', { colorful: true, height: 270 })}
        {dimCard('Lead source distribution', d?.source, 'source', ['touches', 'converted'], 'tone-orange', { asTable: true, height: 270, help: 'Touch Source__c: total lead touches, converted leads and total leads (Tableau sheet "Lead source distribution").' })}
        {dimCard('Class (converted lead touches)', d?.class_raw, 'class_raw', ['touches', 'converted'], 'tone-violet', { limit: 14, height: 300, colorful: true })}
        {dimCard('Reason', d?.reason, 'lm_reason', ['leads'], 'tone-amber', { limit: 14, height: 300, help: def.reason, subtitle: 'Total leads by LM reason · see the help icon for the deviation from Tableau' })}
        {dimCard('Medium', d?.medium, 'medium', ['leads', 'converted'], 'tone-green', { asTable: true, height: 260 })}
        {dimCard('Campaign name', d?.campaign, 'campaign', ['leads', 'touches'], 'tone-blue', { asTable: true, height: 260 })}
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
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
