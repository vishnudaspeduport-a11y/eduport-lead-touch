import { useState } from 'react';
import { useApi } from '../lib/api';
import { LIST_DIMS, useFilters, type ListDim } from '../lib/filters';
import type { BreakdownResponse, BreakdownRow } from '../lib/types';
import { fmt2, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from './ChartCard';
import { HBars } from '../charts';
import { Segmented } from './ui';
import type { Col } from './DataTable';

type Metric = 'leads' | 'converted' | 'conv_rate' | 'revenue' | 'avg_touches' | 'touches';
const METRICS: { value: Metric; label: string; fmt: (v: number) => string }[] = [
  { value: 'leads', label: 'Leads', fmt: fmtInt }, { value: 'converted', label: 'Conv.', fmt: fmtInt }, { value: 'conv_rate', label: 'Conv %', fmt: fmtPct },
  { value: 'revenue', label: 'Revenue', fmt: fmtINR }, { value: 'avg_touches', label: 'Avg touches', fmt: fmt2 }, { value: 'touches', label: 'Touches', fmt: fmtInt },
];

/** Boolean dimensions map to flag filters rather than list filters. Label of the "true" bucket as returned by the API. */
type BoolDim = 'paid' | 'hot' | 'supreme_hot' | 'relogged' | 'repeat' | 'pre_existing';
const BOOL_TRUE: Record<BoolDim, string> = { paid: 'Paid', hot: 'Hot', supreme_hot: 'Supreme Hot', relogged: 'Re-logged', repeat: 'Repeat', pre_existing: 'Pre-existing' };
const isListDim = (d: string): d is ListDim => (LIST_DIMS as readonly string[]).includes(d);

export const BREAKDOWN_COLS: Col<BreakdownRow>[] = [
  { key: 'key', header: 'Segment' },
  { key: 'leads', header: 'Leads', bar: true },
  { key: 'converted', header: 'Converted' },
  { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) },
  { key: 'revenue', header: 'Revenue', render: (v) => fmtINR(v as number) },
  { key: 'revenue_per_lead', header: 'Rev / lead', render: (v) => fmtINR(v as number) },
  { key: 'touches', header: 'Touches' },
  { key: 'avg_touches', header: 'Avg touches', render: (v) => fmt2(v as number) },
];

/**
 * Generic "breakdown by dimension" card: bars of a chosen metric, click a bar to
 * cross-filter (adds a filter chip), table toggle, CSV/PNG. Used across Segments,
 * Overview, Source & campaign.
 */
export function BreakdownCard({ dim, title, subtitle, limit = 12, defaultMetric = 'leads', height = 240, help, minLeadsForRate = 20 }: {
  dim: ListDim | BoolDim; title: string; subtitle?: string; limit?: number; defaultMetric?: Metric; height?: number; help?: string; minLeadsForRate?: number;
}) {
  const { f, params, toggleValue, set } = useFilters();
  const [metric, setMetric] = useState<Metric>(defaultMetric);
  const q = useApi<BreakdownResponse>('/breakdown', { ...params, dim, limit, sort: metric === 'conv_rate' ? 'leads' : metric });
  const rows = q.data?.data.rows ?? [];
  const m = METRICS.find((x) => x.value === metric)!;

  const isSelected = (key: string): boolean => {
    if (isListDim(dim)) return (f.lists[dim] ?? []).includes(key);
    if (dim === 'paid') return f.paid === (key === 'Paid' ? 'paid' : 'organic');
    return f.flags[dim] === (key === BOOL_TRUE[dim] ? '1' : '0');
  };
  const onClick = (key: string) => {
    if (isListDim(dim)) return toggleValue(dim, key);
    if (dim === 'paid') { const v = key === 'Paid' ? 'paid' : 'organic'; return set({ paid: f.paid === v ? undefined : v }); }
    const v = key === BOOL_TRUE[dim] ? '1' : '0';
    set((p) => ({ ...p, flags: { ...p.flags, [dim]: p.flags[dim] === v ? undefined : v } }));
  };

  const sorted = metric === 'conv_rate' ? [...rows].filter((r) => r.leads >= minLeadsForRate).sort((a, b) => (b.conv_rate ?? 0) - (a.conv_rate ?? 0)) : rows;
  const data = sorted.map((r) => ({
    key: r.key, value: (r[metric] as number | null) ?? 0, secondary: metric === 'conv_rate' ? r.leads : r.conv_rate, selected: isSelected(r.key),
    extra: r.previous ? { 'Prev leads': fmtInt(r.previous.leads), 'Prev conv %': fmtPct(r.previous.conv_rate) } : undefined,
  }));
  const total = q.data?.data.total;
  return (
    <ChartCard title={title} subtitle={subtitle ?? (total ? `${fmtInt(total.leads)} leads · ${fmtPct(total.conv_rate)} conv · click a bar to filter` : undefined)}
      loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={rows} columns={BREAKDOWN_COLS} height={height}
      help={help ?? `Leads grouped by ${dim}. Lead-level dimensions count each lead once; touch-level dimensions count distinct leads touched and attribute revenue linearly across their pre-conversion touches.`}
      actions={<Segmented<Metric> size="xs" value={metric} onChange={setMetric} options={METRICS.map(({ value, label }) => ({ value, label }))} />}>
      <HBars data={data} format={m.fmt} valueLabel={m.label} secondaryLabel={metric === 'conv_rate' ? 'Leads' : 'Conv %'} secondaryFormat={metric === 'conv_rate' ? fmtInt : fmtPct} onClick={onClick} />
    </ChartCard>
  );
}
