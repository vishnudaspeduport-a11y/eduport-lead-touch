import { useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { CohortsResponse } from '../lib/types';
import { fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { VBars } from '../charts';
import { Note, PageHeader, Segmented } from '../components/ui';
import { seqColor, seqInk, useTheme } from '../lib/palette';

const COLS: { k: 'r7' | 'r14' | 'r30' | 'r60' | 'r90' | 'r_all'; m?: 'd7' | 'd14' | 'd30' | 'd60' | 'd90'; label: string }[] = [
  { k: 'r7', m: 'd7', label: '7d' }, { k: 'r14', m: 'd14', label: '14d' }, { k: 'r30', m: 'd30', label: '30d' }, { k: 'r60', m: 'd60', label: '60d' }, { k: 'r90', m: 'd90', label: '90d' }, { k: 'r_all', label: 'to date' },
];

export default function Cohorts() {
  const { params } = useFilters();
  const [grain, setGrain] = useState<'month' | 'week'>('month');
  const q = useApi<CohortsResponse>('/cohorts', { ...params, grain });
  const d = q.data?.data;
  const rows = d?.rows ?? [];
  const { dark } = useTheme();
  const max = Math.max(1, ...rows.flatMap((r) => COLS.map((c) => r[c.k] ?? 0)));
  const fw = d?.first_week_share;
  return (
    <div className="space-y-3">
      <PageHeader title="Cohorts & velocity" subtitle="How fast does each cohort convert, and how much of it lands in the first week?" right={<Segmented value={grain} onChange={setGrain} options={[{ value: 'month', label: 'Monthly' }, { value: 'week', label: 'Weekly' }]} />} />

      <div className="grid grid-cols-4 gap-2">
        {[['Converted (mature cohorts)', fmtInt(fw?.converted)], ['…within 7 days', `${fmtInt(fw?.within_7)} (${fmtPct(fw?.share_7)})`], ['…within 30 days', `${fmtInt(fw?.within_30)} (${fmtPct(fw?.share_30)})`], ['Cohorts shown', fmtInt(rows.length)]].map(([k, v]) => (
          <div key={k} className="card"><div className="truncate text-[10px] uppercase tracking-wide text-ink-3">{k}</div><div className="text-base font-semibold leading-tight tabular-nums">{v}</div></div>
        ))}
      </div>

      <ChartCard title={`Cohort conversion triangle (${grain})`} subtitle="cohort = lead created period · cell = % converted within N days · greyed = cohort not yet N days old" loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows} height={Math.max(260, 28 * rows.length + 60)}
        help="Always on the lead-created basis. Converted within N days = first valid payment_date − created_date ≤ N (pre-existing customers with negative days are excluded from these columns). Cells whose cohort is younger than N days are immature and greyed out.">
        <div className="overflow-auto text-xs">
          <table className="w-full border-separate border-spacing-[2px]">
            <thead><tr><th className="th !static text-left">Cohort</th><th className="th !static text-right">Leads</th>{COLS.map((c) => <th key={c.k} className="th !static text-center">{c.label}</th>)}<th className="th !static text-right">Revenue</th><th className="th !static text-right">1st-week share</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cohort}>
                  <td className="px-1 font-medium">{r.cohort.slice(0, grain === 'month' ? 7 : 10)}</td>
                  <td className="px-1 text-right tabular-nums">{fmtInt(r.leads)}</td>
                  {COLS.map((c) => {
                    const mature = c.m ? r.mature[c.m] : true;
                    const v = r[c.k];
                    const t = mature && v != null ? v / max : NaN;
                    return <td key={c.k} className="h-6 rounded-sm text-center tabular-nums" title={`${r.cohort} · ${c.label}: ${fmtPct(v)} (${fmtInt(c.k === 'r_all' ? r.c_all : r[c.k.replace('r', 'c') as 'c7'])} leads)`}
                      style={{ background: mature ? seqColor(t, dark) : dark ? '#2c2c2a' : '#f0efec', color: mature ? seqInk(t) : '#898781' }}>{mature ? fmtPct(v) : '·'}</td>;
                  })}
                  <td className="px-1 text-right tabular-nums">{fmtINR(r.revenue)}</td>
                  <td className="px-1 text-right tabular-nums">{fmtPct(r.first_week_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Days-to-convert distribution" subtitle="converted leads in the window" loading={q.isLoading} error={q.error} rows={d?.days_to_convert ?? []} height={240}
          help="first valid payment_date − lead created_date (IST). 'Before lead' = pre-existing customers whose payment predates the lead record.">
          <VBars data={(d?.days_to_convert ?? []).map((r) => ({ bucket: r.bucket, leads: r.leads }))} xKey="bucket" bars={[{ key: 'leads', label: 'Converted leads' }]} />
        </ChartCard>
        <ChartCard title="Share of eventual conversion captured in week 1" subtitle="per cohort · c7 / c_all" loading={q.isLoading} error={q.error} rows={rows} height={240}
          help="For each cohort: conversions within 7 days divided by all conversions to date. A falling share on recent cohorts is expected (they are still maturing); a falling share on old cohorts means the sales cycle is lengthening.">
          <VBars data={rows.map((r) => ({ cohort: r.cohort.slice(0, grain === 'month' ? 7 : 10), share: r.first_week_share ?? 0 }))} xKey="cohort" bars={[{ key: 'share', label: 'Week-1 share %' }]} format={(v) => fmtPct(v)} />
        </ChartCard>
      </div>
      <Note>Cohort pages ignore the date-basis toggle (they are always by created date) but honour every other filter. Comparison period is not applied here.</Note>
    </div>
  );
}
