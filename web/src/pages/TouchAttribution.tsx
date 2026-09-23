import { useState, type ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { HBars, VBars } from '../charts';
import { Icon, Note, PageHeader, Popover, Skeleton } from '../components/ui';
import { DrillDrawer, type Drill } from '../components/DrillDrawer';

interface AttrRow { key: string; touches: number; leads: number; converted: number; attributed: number; conv_pct: number | null; attr_pct: number | null; share_pct: number | null }
interface Resp {
  mode: 'first' | 'last'; period: { from: string; to: string };
  kpis: { touches: number; leads: number; converted: number; attributed: number; attributed_touches: number; conv_pct: number | null; attr_pct: number | null; attr_of_converted_pct: number | null };
  touch_point: AttrRow[]; class_raw: AttrRow[]; source: AttrRow[]; medium: AttrRow[]; campaign: AttrRow[];
  daily: { d: string; leads: number; attributed: number }[];
  definitions: Record<string, string>;
}

function Kpi({ title, value, sub, def, tone, icon, onClick }: { title: string; value: string; sub?: string; def?: string; tone: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <div className={`card ${tone} relative flex min-h-[92px] flex-col justify-between gap-1 overflow-hidden ${onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-pop' : ''}`} onClick={onClick} title={onClick ? 'Click to see the leads' : undefined}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-tone opacity-70" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tone-solid text-white shadow">{icon}</span>
          <div className="line-clamp-2 text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink-3" title={title}>{title}</div>
        </div>
        {def && <span onClick={(e) => e.stopPropagation()}><Popover align="right" width="w-80" trigger={<button className="relative rounded p-0.5 text-ink-3 hover:text-ink"><Icon.Help /></button>}><div className="text-xs leading-relaxed text-ink-2">{def}</div></Popover></span>}
      </div>
      <div>
        <div className="text-2xl font-extrabold leading-none tabular-nums tracking-tight">{value}</div>
        {sub && <div className="mt-1 truncate text-[10px] text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}

/** Tableau "Lead Touch - First Touch" / "Lead Touch - Last Touch": every converted lead credited to exactly one touch. */
export default function TouchAttribution({ mode }: { mode: 'first' | 'last' }) {
  const { f, params, toggleValue } = useFilters();
  const q = useApi<Resp>('/touch-attribution', { ...params, mode });
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};
  const [drill, setDrill] = useState<Drill | null>(null);
  const label = mode === 'first' ? 'First-touch conversions' : 'Last-touch conversions';
  const metric = mode === 'first' ? 'first_touch' : 'last_touch';

  const cols: Col<AttrRow>[] = [
    { key: 'key', header: '' }, { key: 'leads', header: 'Total leads' }, { key: 'converted', header: 'Converted' },
    { key: 'attributed', header: label, bar: true }, { key: 'attr_pct', header: mode === 'first' ? 'Percentage' : 'Last-touch %', render: (v) => fmtPct(v as number) },
    { key: 'conv_pct', header: 'Conv %', render: (v) => fmtPct(v as number) }, { key: 'share_pct', header: 'Share', render: (v) => fmtPct(v as number) },
  ];

  const card = (title: string, rows: AttrRow[] | undefined, dim: ListDim, tone: string, opts: { asTable?: boolean; height?: number; limit?: number; help?: string } = {}) => {
    const selected = f.lists[dim] ?? [];
    const data = (rows ?? []).slice(0, opts.limit ?? 14);
    return (
      <ChartCard title={title} tone={tone} subtitle={rows ? `${fmtInt(rows.reduce((s, r) => s + r.attributed, 0))} ${label.toLowerCase()} · click a row to filter every card` : undefined}
        loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows ?? []} columns={cols} height={opts.height ?? 340}
        help={opts.help ?? `${title}: ${def.attributed ?? ''} Total leads and Converted are the same measures as the Overview.`}>
        {opts.asTable
          ? <DataTable rows={rows ?? []} compact maxHeight="100%" initialSort={{ id: 'attributed', desc: true }} onRowClick={(r) => toggleValue(dim, r.key)} columns={cols} />
          : <HBars colorful data={data.map((r) => ({ key: r.key, value: r.attributed, secondary: r.share_pct, selected: selected.includes(r.key), extra: { 'Total leads': fmtInt(r.leads), Converted: fmtInt(r.converted), [mode === 'first' ? 'Percentage' : 'Last-touch %']: fmtPct(r.attr_pct) } }))}
              valueLabel={label} secondaryLabel="Share" onClick={(key) => toggleValue(dim, key)} />}
      </ChartCard>
    );
  };

  return (
    <div className="space-y-3">
      <PageHeader title={mode === 'first' ? 'First touch' : 'Last touch'}
        subtitle={`touch date ${f.from} → ${f.to} · same definitions as the Tableau "Lead Touch - ${mode === 'first' ? 'First' : 'Last'} Touch" dashboard`} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {q.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
        {k && <>
          <Kpi tone="tone-blue" icon={<Icon.Users />} title="Total leads" value={fmtInt(k.leads)} sub="distinct leads touched in the window" def={def.leads} onClick={() => setDrill({ metric: 'leads', title: 'Total leads' })} />
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Converted" value={fmtInt(k.converted)} sub={`${fmtPct(k.conv_pct)} of touched leads`} def={def.converted} onClick={() => setDrill({ metric: 'converted', title: 'Converted' })} />
          <Kpi tone={mode === 'first' ? 'tone-green' : 'tone-pink'} icon={<Icon.Touch />} title={label} value={fmtInt(k.attributed)} sub={`${fmtPct(k.attr_of_converted_pct)} of converted leads have their ${mode} touch in the window`} def={def.attributed}
            onClick={() => setDrill({ metric, title: label })} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title={mode === 'first' ? 'Percentage' : 'Last-touch %'} value={fmtPct(k.attr_pct)} sub={`${label.toLowerCase()} ÷ total leads`} def={def.attr_pct} />
        </>}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {card('Touch point analysis (converted leads)', d?.touch_point, 'touch_point', 'tone-teal')}
        {card('Class wise distribution', d?.class_raw, 'class_raw', 'tone-violet')}
        {card('Lead source distribution', d?.source, 'source', 'tone-orange', { asTable: true })}
        {card('Medium', d?.medium, 'medium', 'tone-green', { asTable: true })}
        {card('Campaign name', d?.campaign, 'campaign', 'tone-blue', { asTable: true })}
        <ChartCard title={`${label} per day`} tone="tone-pink" subtitle={`distinct leads and ${label.toLowerCase()} by touch date`} loading={q.isLoading} error={q.error} rows={d?.daily ?? []} height={340}>
          <VBars data={(d?.daily ?? []).map((r) => ({ d: r.d.slice(5), leads: r.leads, attributed: r.attributed }))} xKey="d" bars={[{ key: 'leads', label: 'Leads' }, { key: 'attributed', label }]} />
        </ChartCard>
      </div>

      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
      <Note>
        {mode === 'first'
          ? <>Each converted lead is credited to <b>one</b> touch: its selected first touch (earliest touch on/after 1 March 2026, or its latest touch if none after that date), exactly as the workbook's "first touch" measure. </>
          : <>Each lead is credited to <b>one</b> touch: its last valid touch, the latest touch made <b>before the moment of its last valid payment</b>. A touch on the payment day counts when it happened before the payment. This deliberately differs from the workbook, which never credits payment-day touches (its formula reads the payment date as midnight), so this page credits Eduport App more and earlier channels less than Tableau. </>}
        So the {label.toLowerCase()} column adds up across rows, unlike Total leads and Converted, where a lead can appear under several values. Clicking a KPI lists the leads; clicking a bar or row filters every card.
      </Note>
    </div>
  );
}
