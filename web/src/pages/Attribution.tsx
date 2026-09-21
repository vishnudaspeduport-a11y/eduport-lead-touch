import { useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import type { AttributionResponse } from '../lib/types';
import { fmt1, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { VBars } from '../charts';
import { Note, PageHeader, Segmented } from '../components/ui';
import { useTheme } from '../lib/palette';

const DIMS: { value: ListDim; label: string }[] = [{ value: 'touch_point', label: 'Touch point' }, { value: 'source', label: 'Source' }, { value: 'medium', label: 'Medium' }, { value: 'campaign', label: 'Campaign' }, { value: 'ad_set', label: 'Ad set' }, { value: 'staff', label: 'Staff' }];

export default function Attribution() {
  const { params, toggleValue } = useFilters();
  const [dim, setDim] = useState<ListDim>('touch_point');
  const [measure, setMeasure] = useState<'conv' | 'rev'>('conv');
  const q = useApi<AttributionResponse>('/attribution', { ...params, dim, limit: 40 });
  const d = q.data?.data;
  const rows = d?.rows ?? [];
  const { series } = useTheme();
  const top = rows.slice(0, 12);
  const chartData = top.map((r) => measure === 'conv'
    ? { key: r.key, first: r.first_touch, last: r.last_touch, linear: r.linear, position: r.position }
    : { key: r.key, first: r.rev_first, last: r.rev_last, linear: r.rev_linear, position: r.rev_position });
  const fmt = measure === 'conv' ? fmt1 : fmtINR;
  const u = d?.unattributed;

  return (
    <div className="space-y-3">
      <PageHeader title="Attribution" subtitle="First-touch, last-touch, linear and position-based (40/20/40) credit side by side" right={<Segmented value={dim} onChange={setDim} options={DIMS} />} />

      <div className="grid grid-cols-5 gap-2">
        {[['Converted (attributable)', d?.totals.last_touch], ['Unattributed conversions', u?.unattributed], ['· never touched', u?.never_touched], ['· touched only after paying', u?.touched_after_only], ['· pre-existing customers', u?.pre_existing]].map(([k, v]) => (
          <div key={String(k)} className="card"><div className="truncate text-[10px] uppercase tracking-wide text-ink-3">{k}</div><div className="text-base font-semibold leading-tight tabular-nums">{fmtInt(v as number)}</div></div>
        ))}
      </div>

      <ChartCard title={`Credit by ${DIMS.find((x) => x.value === dim)?.label} under four models`} subtitle="top 12 by last-touch · click a bar to filter" loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows} height={290}
        help={<><p>Only touches on/before the payment date of a converted lead carry credit. First / last: 1.0 to that touch. Linear: 1/n each. Position: 40% first, 40% last, 20% split across the middle (1 touch = 100%, 2 touches = 50/50). Revenue credit = credit × the lead's valid payment total.</p><p className="mt-1">{d?.note}</p></>}
        actions={<Segmented size="xs" value={measure} onChange={setMeasure} options={[{ value: 'conv', label: 'Conversions' }, { value: 'rev', label: 'Revenue' }]} />}>
        <VBars data={chartData} xKey="key" bars={[{ key: 'first', label: 'First touch' }, { key: 'last', label: 'Last touch' }, { key: 'linear', label: 'Linear' }, { key: 'position', label: 'Position 40/20/40' }]} format={fmt} onClick={(k) => toggleValue(dim, k)} />
      </ChartCard>

      <ChartCard title="Over- / under-credited by last touch" subtitle="diff = last-touch credit − linear credit (positive = last-touch flatters this channel)" loading={q.isLoading} error={q.error} rows={rows} height={310}
        help="Channels with a large positive diff appear only at the end of journeys (closers); large negative diff = channels that start journeys but rarely close them (openers). Share columns are each model's share of all attributable conversions.">
        <DataTable rows={rows} compact initialSort={{ id: 'last_touch', desc: true }} onRowClick={(r) => toggleValue(dim, r.key)} columns={[
          { key: 'key', header: DIMS.find((x) => x.value === dim)?.label ?? dim },
          { key: 'touches', header: 'Touches' }, { key: 'leads', header: 'Leads touched' },
          { key: 'first_touch', header: 'First', render: (v) => fmt1(v as number) }, { key: 'last_touch', header: 'Last', render: (v) => fmt1(v as number), bar: true },
          { key: 'linear', header: 'Linear', render: (v) => fmt1(v as number) }, { key: 'position', header: 'Position', render: (v) => fmt1(v as number) },
          { key: 'diff_last_vs_linear', header: 'Last − linear', render: (v) => <span style={{ color: (v as number) > 0.5 ? series[1] : (v as number) < -0.5 ? series[0] : undefined }}>{(v as number) > 0 ? '+' : ''}{fmt1(v as number)}</span> },
          { key: 'share_last', header: 'Share (last)', render: (v) => fmtPct(v as number) }, { key: 'share_linear', header: 'Share (linear)', render: (v) => fmtPct(v as number) },
          { key: 'rev_last', header: 'Rev (last)', render: (v) => fmtINR(v as number) }, { key: 'rev_linear', header: 'Rev (linear)', render: (v) => fmtINR(v as number) },
        ]} />
      </ChartCard>

      <Note><b>What falls into "unattributed":</b> converted leads with no touch dated on or before their first valid payment. That is (a) leads never touched at all, (b) leads whose touches all happened after they paid (post-sale noise), and (c) pre-existing customers, whose payment predates the lead itself. Revenue in that bucket: {fmtINR(u?.unattributed_revenue)}. Salesforce's own Attribution_Credit__c / Credit_Value__c are kept on each touch for comparison in the lead drawer but are not used here.</Note>
    </div>
  );
}
