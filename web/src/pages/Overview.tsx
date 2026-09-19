import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useFilters, DIM_LABEL, type ListDim } from '../lib/filters';
import type { FunnelResponse, KpisResponse, MoversResponse, TrendResponse } from '../lib/types';
import { delta, fmt1, fmt2, fmtHours, fmtINR, fmtInt, fmtPP, fmtPct } from '../lib/format';
import { KpiCard } from '../components/KpiCard';
import { ChartCard } from '../components/ChartCard';
import { HBars, TrendChart, VBars } from '../charts';
import { Note, PageHeader, Segmented, Skeleton } from '../components/ui';
import { BreakdownCard } from '../components/BreakdownCard';

export default function Overview() {
  const { f, params, toggleValue } = useFilters();
  const nav = useNavigate();
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('day');
  const k = useApi<KpisResponse>('/kpis', params);
  const t = useApi<TrendResponse>('/trend', { ...params, grain });
  const fun = useApi<FunnelResponse>('/funnel', params);
  const mv = useApi<MoversResponse>('/movers', { ...params, min: 30, limit: 8 });

  const cur = k.data?.data.current;
  const prev = k.data?.data.previous ?? null;
  const cmp = f.compare && prev;

  const trendRows = useMemo(() => {
    const rows = t.data?.data.rows ?? [];
    const prevRows = t.data?.data.previous ?? [];
    return rows.map((r, i) => ({
      d: r.d, leads: r.leads, converted: r.converted, touches: r.touches, revenue: r.revenue,
      conv_rate: r.leads ? Math.round((r.converted / r.leads) * 10000) / 100 : null,
      prev_leads: prevRows[i]?.leads ?? null,
      prev_conv_rate: prevRows[i]?.leads ? Math.round((prevRows[i].converted / prevRows[i].leads) * 10000) / 100 : null,
    }));
  }, [t.data]);

  const loading = k.isLoading;
  const cards = cur ? [
    { key: 'leads', title: 'Total leads', value: fmtInt(cur.leads), d: cmp ? delta(cur.leads, prev.leads) : undefined, sub: `${fmtInt(cur.contacted)} contacted (${fmtPct(cur.contact_rate)})` },
    { key: 'touches', title: 'Total touches', value: fmtInt(cur.touches), d: cmp ? delta(cur.touches, prev.touches) : undefined, sub: `${fmtInt(cur.valid_touches)} before payment` },
    { key: 'touches_per_lead', title: 'Touches per lead', value: fmt2(cur.touches_per_lead), d: cmp ? delta(cur.touches_per_lead, prev.touches_per_lead) : undefined, sub: `${fmtInt(cur.touched_leads)} leads touched` },
    { key: 'converted', title: 'Converted leads', value: fmtInt(cur.converted), d: cmp ? delta(cur.converted, prev.converted) : undefined, sub: `${fmtInt(cur.pre_existing)} pre-existing customers` },
    { key: 'conv_rate', title: 'Conversion %', value: fmtPct(cur.conv_rate, 2), d: cmp ? delta(cur.conv_rate, prev.conv_rate, 'pp') : undefined, sub: cmp ? `prev ${fmtPct(prev.conv_rate, 2)}` : undefined },
    { key: 'avg_touches_to_convert', title: 'Avg touches to convert', value: fmt2(cur.avg_touches_to_convert), d: cmp ? delta(cur.avg_touches_to_convert, prev.avg_touches_to_convert, 'num') : undefined, sub: `median ${fmt1(cur.median_touches_to_convert)} · p90 ${fmt1(cur.p90_touches_to_convert)}` },
    { key: 'avg_days_to_convert', title: 'Avg days to convert', value: fmt1(cur.avg_days_to_convert), d: cmp ? delta(cur.avg_days_to_convert, prev.avg_days_to_convert, 'num') : undefined, invert: true, sub: `median ${fmt1(cur.median_days_to_convert)} d` },
    { key: 'revenue', title: 'Revenue', value: fmtINR(cur.revenue), d: cmp ? delta(cur.revenue, prev.revenue) : undefined, sub: cur.refunds ? `refunds ${fmtINR(cur.refunds)}` : undefined },
    { key: 'revenue_per_lead', title: 'Revenue per lead', value: fmtINR(cur.revenue_per_lead), d: cmp ? delta(cur.revenue_per_lead, prev.revenue_per_lead) : undefined },
    { key: 'first_touch_conversions', title: 'First-touch conversions', value: fmtInt(cur.first_touch_conversions), d: cmp ? delta(cur.first_touch_conversions, prev.first_touch_conversions) : undefined, sub: `${fmtInt(cur.unattributed)} unattributed` },
    { key: 'last_touch_conversions', title: 'Last-touch conversions', value: fmtInt(cur.last_touch_conversions), d: cmp ? delta(cur.last_touch_conversions, prev.last_touch_conversions) : undefined },
    { key: 'response_hours', title: 'Median response time', value: fmtHours(cur.median_response_hours), d: cmp ? delta(cur.median_response_hours, prev.median_response_hours, 'num') : undefined, invert: true, sub: 'lead created → first touch' },
  ] : [];

  const stages = fun.data?.data.stages ?? [];
  const movers = mv.data?.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" subtitle={`${f.from} → ${f.to} · basis: ${f.basis}${f.compare ? ' · vs previous period' : ''}`} />
      {k.error && <Note>⚠ {k.error.message}</Note>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {loading && Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        {cards.map((c) => <KpiCard key={c.key} defKey={c.key} title={c.title} value={c.value} delta={c.d ?? undefined} sub={c.sub} invert={c.invert} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Leads and conversion over time" subtitle={t.data ? `source: ${t.data.data.source}` : undefined}
          loading={t.isLoading} error={t.error} onRetry={t.refetch} rows={trendRows} height={340}
          help="Bars: leads per period on the selected date basis. Line: converted / leads for that period. The two panels share the x-axis; each has its own single y-axis. Dashed = previous period aligned by position."
          actions={<Segmented size="xs" value={grain} onChange={setGrain} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />}>
          <TrendChart data={trendRows} compare={!!cmp} />
        </ChartCard>

        <ChartCard title="Lead stage funnel" subtitle="click a stage to filter" loading={fun.isLoading} error={fun.error} onRetry={fun.refetch} height={340}
          rows={stages} columns={[{ key: 'stage', header: 'Stage' }, { key: 'leads', header: 'Leads', bar: true }, { key: 'converted', header: 'Converted' }, { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) }]}
          help="Current Lead_Stage__c distribution for the leads in the window, with the payment-based conversion rate of each stage. Stage history is not replicated, so this is a snapshot, not a flow.">
          <HBars data={stages.map((s) => ({ key: s.stage, value: s.leads, secondary: s.conv_rate, selected: (f.lists.lead_stage ?? []).includes(s.stage) }))} valueLabel="Leads" secondaryLabel="Conv %" onClick={(k) => toggleValue('lead_stage', k)} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Touches-to-convert distribution" subtitle="converted leads by number of pre-payment touches" loading={k.isLoading} error={k.error} height={260}
          rows={cur?.touch_buckets ?? []} help="Each converted lead is bucketed by the count of touches whose IST date is on or before its first valid payment date. '0' = converted without any prior touch (unattributed).">
          <VBars data={(cur?.touch_buckets ?? []).map((b) => ({ bucket: b.bucket, converted: b.converted, leads: b.leads }))} xKey="bucket" bars={[{ key: 'converted', label: 'Converted leads' }]} onClick={(b) => toggleValue('touch_bucket', b)} />
        </ChartCard>

        <ChartCard className="xl:col-span-2" title="Biggest movers vs previous period" subtitle={movers ? `segments with ≥ ${movers.min_leads} leads in both periods · previous = ${movers.previous.from} → ${movers.previous.to}` : undefined}
          loading={mv.isLoading} error={mv.error} onRetry={mv.refetch} height={260} rows={[...(movers?.up ?? []), ...(movers?.down ?? [])]}
          help="For each dimension (lead source, class group, district, owner, lead type, first/last touch point, app tier, campaign quality) the conversion rate of every segment is compared with the immediately preceding period of the same length. Ranked by impact = change in percentage points × current leads.">
          <div className="grid h-full grid-cols-2 gap-3 overflow-auto text-xs">
            {(['up', 'down'] as const).map((dir) => (
              <div key={dir}>
                <div className={`mb-1 font-semibold ${dir === 'up' ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#d03b3b]'}`}>{dir === 'up' ? '▲ Improving' : '▼ Declining'}</div>
                {(movers?.[dir] ?? []).length === 0 && <div className="text-ink-3">Nothing significant</div>}
                {(movers?.[dir] ?? []).map((r) => (
                  <button key={`${r.dim}:${r.key}`} className="mb-1 flex w-full items-center justify-between gap-2 rounded border border-line px-2 py-1 text-left hover:border-accent" onClick={() => toggleValue(r.dim as ListDim, r.key)} title="Click to filter">
                    <span className="min-w-0 truncate"><span className="text-ink-3">{DIM_LABEL[r.dim] ?? r.dim}:</span> {r.key}</span>
                    <span className="shrink-0 tabular-nums"><span className="text-ink-3">{fmtPct(r.prev_rate)} →</span> {fmtPct(r.rate)} <span className={dir === 'up' ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#d03b3b]'}>({fmtPP(r.delta_pp)})</span> <span className="text-ink-3">n={fmtInt(r.leads)}</span></span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownCard dim="lead_source" title="By lead source" />
        <BreakdownCard dim="class_group" title="By class group" />
      </div>
      <div className="text-right"><button className="btn" onClick={() => nav({ pathname: '/leads', search: window.location.search })}>Open these leads in the explorer →</button></div>
    </div>
  );
}
