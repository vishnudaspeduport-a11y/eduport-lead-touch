import { useState, type ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters } from '../lib/filters';
import { fmt1, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { HBars } from '../charts';
import { Icon, Note, PageHeader, Popover, Segmented, Skeleton } from '../components/ui';
import { DrillDrawer, type Drill } from '../components/DrillDrawer';

interface StaffRow { key: string; leads: number; touches: number; converted: number; first_touch_conv: number; last_touch_conv: number; revenue_last: number; revenue_linear: number; median_response_h: number | null; new_leads: number; conv_pct: number | null }
interface ColdRow { key: string; open: number; gt7: number; gt14: number; gt30: number }
interface Resp {
  by: 'staff' | 'owner'; period: { from: string; to: string };
  kpis: { leads: number; touches: number; converted: number; last_touch_conv: number; revenue_last: number; median_response_h: number | null; new_leads: number; with_staff: number; conv_pct: number | null; staff_coverage_pct: number | null };
  rows: StaffRow[];
  cold: { open: number; gt7: number; gt14: number; gt30: number; by_key: ColdRow[]; by_touch_point: ColdRow[]; by_stage: ColdRow[]; age: { bucket: string; n: number }[] };
  definitions: Record<string, string>;
}

const fmtH = (h: number | null) => (h == null ? '–' : h < 48 ? `${fmt1(h)} h` : `${fmt1(h / 24)} d`);

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

/** Staff & follow-up: who touches, who closes, and which leads are going cold. */
export default function StaffFollowUp() {
  const { f, params, toggleValue } = useFilters();
  const [by, setBy] = useState<'staff' | 'owner'>('staff');
  const q = useApi<Resp>('/staff', { ...params, by });
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};
  const [drill, setDrill] = useState<Drill | null>(null);
  const who = by === 'staff' ? 'Staff (touch)' : 'Owner (lead)';
  const dim = by === 'staff' ? 'staff' : 'owner';

  const staffCols: Col<StaffRow>[] = [
    { key: 'key', header: who }, { key: 'leads', header: 'Leads touched', bar: true }, { key: 'touches', header: 'Touches' },
    { key: 'converted', header: 'Converted' }, { key: 'conv_pct', header: 'Conv %', render: (v) => fmtPct(v as number) },
    { key: 'last_touch_conv', header: 'Last-touch credited' }, { key: 'first_touch_conv', header: 'First-touch credited' },
    { key: 'revenue_last', header: 'Revenue (last touch)', render: (v) => fmtINR(v as number) }, { key: 'revenue_linear', header: 'Revenue (linear share)', render: (v) => fmtINR(v as number) },
    { key: 'new_leads', header: 'New leads' }, { key: 'median_response_h', header: 'Median response', render: (v) => fmtH(v as number | null) },
  ];
  const coldCols: Col<ColdRow>[] = [
    { key: 'key', header: '' }, { key: 'open', header: 'Open leads' }, { key: 'gt7', header: '> 7 days', bar: true }, { key: 'gt14', header: '> 14 days' }, { key: 'gt30', header: '> 30 days' },
  ];
  const coldDrill = (days: number, dimKey?: string, value?: string) => setDrill({ metric: 'cold', title: `Going cold · no touch for ${days}+ days`, dim: dimKey, value, subtitle: `open leads touched in the window whose last touch (any time) is more than ${days} days ago · not converted, not disqualified`, extra: { days } });

  return (
    <div className="space-y-3">
      <PageHeader title="Staff & follow-up" subtitle={`touch date ${f.from} → ${f.to}`}
        right={<Segmented size="xs" value={by} onChange={setBy} options={[{ value: 'staff', label: 'By touch staff', title: 'Lead_Touch__c.Staff__c' }, { value: 'owner', label: 'By lead owner', title: 'Lead_Master__c.Owner' }]} />} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {q.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
        {k && <>
          <Kpi tone="tone-blue" icon={<Icon.Users />} title="Leads touched" value={fmtInt(k.leads)} sub={`${fmtPct(k.staff_coverage_pct)} have a ${by === 'staff' ? 'staff name on a touch' : 'lead owner'}`} def={def.leads} onClick={() => setDrill({ metric: 'leads', title: 'Leads touched' })} />
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Converted" value={fmtInt(k.converted)} sub={`${fmtPct(k.conv_pct)} of touched leads`} def={def.converted} onClick={() => setDrill({ metric: 'converted', title: 'Converted' })} />
          <Kpi tone="tone-green" icon={<Icon.Touch />} title="Last-touch credited" value={fmtInt(k.last_touch_conv)} sub="conversions credited to a touch in the window" def={def.last_touch_conv} onClick={() => setDrill({ metric: 'last_touch', title: 'Last-touch credited conversions' })} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title="Revenue (last touch)" value={fmtINR(k.revenue_last)} sub="payment amounts of credited leads" def={def.revenue_last} />
          <Kpi tone="tone-teal" icon={<Icon.Calendar />} title="Median response" value={fmtH(k.median_response_h)} sub={`${fmtInt(k.new_leads)} leads created in the window`} def={def.median_response_h} />
          <Kpi tone="tone-pink" icon={<Icon.Spark />} title="Going cold > 7 days" value={fmtInt(d?.cold.gt7 ?? 0)} sub={`${fmtInt(d?.cold.open ?? 0)} open · ${fmtInt(d?.cold.gt14 ?? 0)} > 14 d · ${fmtInt(d?.cold.gt30 ?? 0)} > 30 d`} def={def.cold} onClick={() => coldDrill(7)} />
        </>}
      </div>

      <ChartCard title={`Performance by ${who.toLowerCase()}`} tone="tone-blue" subtitle="click a row to filter every card · sort by any column" loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={d?.rows ?? []} columns={staffCols} height={420}
        help={`${def.leads} ${def.last_touch_conv} ${def.revenue_last} ${def.median_response_h}`}>
        <DataTable rows={d?.rows ?? []} columns={staffCols} compact maxHeight="100%" initialSort={{ id: 'leads', desc: true }} onRowClick={(r) => toggleValue(dim, r.key)} />
      </ChartCard>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="card tone-pink flex flex-col gap-2">
          <div className="flex items-center gap-1.5"><span className="h-3 w-1.5 rounded-full bg-tone-solid" /><h3 className="text-xs font-bold">Going cold · open leads by days since last touch</h3></div>
          <div className="text-[10px] text-ink-3">{def.cold}</div>
          <div className="grid grid-cols-3 gap-2">
            {[7, 14, 30].map((days) => (
              <button key={days} className="rounded-2xl bg-tone p-3 text-left transition hover:-translate-y-0.5 hover:shadow-pop" onClick={() => coldDrill(days)}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">&gt; {days} days</div>
                <div className="text-xl font-extrabold tabular-nums">{fmtInt(d?.cold[`gt${days}` as 'gt7'] ?? 0)}</div>
                <div className="text-[10px] text-ink-3">click for the list</div>
              </button>
            ))}
          </div>
          <div className="mt-1 min-h-0 flex-1" style={{ height: 200 }}>
            <HBars colorful data={(d?.cold.age ?? []).map((a) => ({ key: a.bucket, value: a.n }))} valueLabel="Open leads" />
          </div>
        </div>
        <ChartCard title={`Going cold by ${who.toLowerCase()}`} tone="tone-pink" subtitle="click a row for that person's cold list (> 7 days)" loading={q.isLoading} error={q.error} rows={d?.cold.by_key ?? []} columns={coldCols} height={330}>
          <DataTable rows={d?.cold.by_key ?? []} columns={coldCols} compact maxHeight="100%" initialSort={{ id: 'gt7', desc: true }} onRowClick={(r) => coldDrill(7, dim, r.key)} />
        </ChartCard>
        <ChartCard title="Going cold by touch point / stage" tone="tone-amber" subtitle="click a touch point row for its cold list (> 7 days)" loading={q.isLoading} error={q.error} rows={d?.cold.by_touch_point ?? []} columns={coldCols} height={330}>
          <div className="flex h-full flex-col gap-2 overflow-hidden">
            <div className="min-h-0 flex-1"><DataTable rows={d?.cold.by_touch_point ?? []} columns={coldCols} compact maxHeight="100%" initialSort={{ id: 'gt7', desc: true }} onRowClick={(r) => coldDrill(7, 'touch_point', r.key)} /></div>
            <div className="min-h-0 flex-1"><DataTable rows={d?.cold.by_stage ?? []} columns={coldCols} compact maxHeight="100%" initialSort={{ id: 'open', desc: true }} onRowClick={(r) => coldDrill(7, 'lead_stage', r.key)} /></div>
          </div>
        </ChartCard>
      </div>

      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
      <Note>Staff comes from the touch (who made the contact); Owner comes from the lead. A lead touched by two people is counted for both, so the columns do not add up to the KPI tiles. Conversions use the workbook rule; "credited" columns give each conversion to exactly one person by first or last touch. The going-cold lists exclude leads that ever paid and leads marked Disqualified; their age is measured from the lead's very last touch, even if that touch is outside the selected window.</Note>
    </div>
  );
}
