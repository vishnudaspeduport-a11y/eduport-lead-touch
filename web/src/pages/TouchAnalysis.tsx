import { useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import type { BreakdownResponse, HeatmapResponse, StaleLeadsResponse, TouchCurveResponse, TouchGapsResponse, TransitionsResponse } from '../lib/types';
import { fmt1, fmt2, fmtDateTime, fmtHours, fmtInt, fmtPP, fmtPct, DOW } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { HBars, Heatmap, HOURS, Lines, VBars } from '../charts';
import { Note, PageHeader, Segmented } from '../components/ui';
import { BREAKDOWN_COLS } from '../components/BreakdownCard';
import { LeadDrawer } from '../components/LeadDrawer';

const BY_OPTS: { value: string; label: string }[] = [{ value: '', label: 'All' }, { value: 'lead_source', label: 'Lead source' }, { value: 'class_group', label: 'Class' }, { value: 'first_touch_point', label: 'First touch point' }, { value: 'owner', label: 'Owner' }];

export default function TouchAnalysis() {
  const { params, toggleValue } = useFilters();
  const [by, setBy] = useState('');
  const [staleDays, setStaleDays] = useState(7);
  const [stalePage, setStalePage] = useState(1);
  const [openLead, setOpenLead] = useState<string | null>(null);

  const curve = useApi<TouchCurveResponse>('/touch-curve', { ...params, by: by || undefined });
  const mix = useApi<BreakdownResponse>('/breakdown', { ...params, dim: 'touch_point', limit: 20 });
  const gaps = useApi<TouchGapsResponse>('/touch-gaps', params);
  const heat = useApi<HeatmapResponse>('/touch-heatmap', params);
  const trans = useApi<TransitionsResponse>('/touch-transitions', params);
  const stale = useApi<StaleLeadsResponse>('/stale-leads', { ...params, days: staleDays, page: stalePage, limit: 25 });

  // curve: one line per group, x = touch bucket
  const groups = curve.data?.data.groups ?? [];
  const curveRows = useMemo(() => ['0', '1', '2', '3', '4', '5', '6+'].map((b) => {
    const o: Record<string, unknown> = { bucket: b };
    for (const g of groups.slice(0, 8)) { const p = g.points.find((x) => x.bucket === b); o[g.group] = p?.leads && p.leads >= 20 ? p.conv_rate : null; }
    return o;
  }), [groups]);
  const curveTable = groups.flatMap((g) => g.points.map((p) => ({ group: g.group, ...p, optimal: g.optimal_touches })));

  const heatRows = heat.data?.data.rows ?? [];
  const heatIdx = useMemo(() => { const m = new Map<string, { t: number; c: number }>(); for (const r of heatRows) m.set(`${r.dow}|${r.hour}`, { t: r.touches, c: r.converted_touches }); return m; }, [heatRows]);
  const [heatMetric, setHeatMetric] = useState<'touches' | 'conv'>('touches');

  const tr = trans.data?.data.rows ?? [];
  const points = useMemo(() => { const s = new Set<string>(); tr.forEach((r) => { s.add(r.src); s.add(r.dst); }); return [...s].slice(0, 14); }, [tr]);
  const trIdx = useMemo(() => new Map(tr.map((r) => [`${r.src}|${r.dst}`, r])), [tr]);
  const [trMetric, setTrMetric] = useState<'leads' | 'conv'>('leads');

  const gapRows = gaps.data?.data.buckets ?? [];
  const mixRows = mix.data?.data.rows ?? [];
  const st = stale.data?.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Touch analysis" subtitle="Does one more touch still add conversion? Where do touches happen, and which leads are going cold?" />

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Conversion rate by number of touches" subtitle="the key curve · buckets with < 20 leads hidden" loading={curve.isLoading} error={curve.error} onRetry={curve.refetch} rows={curveTable} height={320}
          help={<><p>Leads bucketed by pre-payment touch count; y = converted / leads in the bucket. Marginal lift = change vs the previous bucket. {curve.data?.data.rule}.</p><p className="mt-1">Caveat: this is correlational. Leads that convert fast get fewer touches, so a falling curve does not mean touches hurt.</p></>}
          actions={<Segmented size="xs" value={by} onChange={setBy} options={BY_OPTS} />}>
          <Lines data={curveRows} xKey="bucket" lines={groups.slice(0, 8).map((g) => ({ key: g.group, label: g.group }))} format={(v) => fmtPct(v)} yLabel="conv %" />
        </ChartCard>

        <ChartCard title="Marginal lift & optimal touch count" loading={curve.isLoading} error={curve.error} height={320} rows={curveTable}
          help="Optimal = the last touch count that still adds meaningful lift (rule shown on the curve card). Use it as the follow-up cap per segment, not as a target.">
          <div className="h-full overflow-auto text-xs">
            {groups.slice(0, 12).map((g) => (
              <div key={g.group} className="mb-2 rounded border border-line p-2">
                <div className="flex items-center justify-between"><span className="font-medium">{g.group}</span><span className="chip">optimal: {g.optimal_touches ?? 'n/a'}</span></div>
                <div className="mt-1 grid grid-cols-7 gap-1 text-center">
                  {g.points.map((p) => (
                    <div key={p.bucket} className={`rounded px-0.5 py-1 ${p.bucket === g.optimal_touches ? 'bg-accent/15 ring-1 ring-accent' : 'bg-surface-2'}`} title={`${fmtInt(p.leads)} leads, ${fmtInt(p.converted)} converted`}>
                      <div className="text-ink-3">{p.bucket}</div>
                      <div className="font-medium tabular-nums">{p.leads >= 20 ? fmtPct(p.conv_rate, 1) : '·'}</div>
                      <div className={`tabular-nums ${p.marginal_lift_pp == null ? 'text-ink-3' : p.marginal_lift_pp > 0 ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#d03b3b]'}`}>{p.marginal_lift_pp == null || p.leads < 20 ? '' : fmtPP(p.marginal_lift_pp)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Touch-point mix" subtitle="distinct leads touched · click to filter" loading={mix.isLoading} error={mix.error} onRetry={mix.refetch} rows={mixRows} columns={BREAKDOWN_COLS} height={320}
          help="Per touch point: distinct leads with ≥1 such touch, distinct converted leads among them (touch before payment), and the conversion rate of touched leads.">
          <HBars data={mixRows.map((r) => ({ key: r.key, value: r.leads, secondary: r.conv_rate, extra: { Touches: fmtInt(r.touches), 'Conv. leads': fmtInt(r.converted) } }))} valueLabel="Leads touched" secondaryLabel="Conv %" onClick={(k) => toggleValue('touch_point', k)} />
        </ChartCard>

        <ChartCard title="Time between consecutive touches" subtitle={gaps.data ? `median ${fmtHours(gaps.data.data.overall.median_hours)} · p90 ${fmtHours(gaps.data.data.overall.p90_hours)}` : undefined} loading={gaps.isLoading} error={gaps.error} onRetry={gaps.refetch}
          rows={gapRows} height={320} help="Each pre-payment touch after the first is bucketed by the hours since the lead's previous touch. Conversion % = converted leads with ≥1 gap in that bucket / leads with ≥1 gap in that bucket. Click a bucket to filter leads that have such a gap.">
          <VBars data={gapRows.map((g) => ({ bucket: g.bucket, touches: g.touches, conv: g.conv_rate }))} xKey="bucket" bars={[{ key: 'touches', label: 'Touches' }]} onClick={(b) => toggleValue('gap_bucket', b)} />
        </ChartCard>

        <ChartCard title="Conversion % by gap bucket" loading={gaps.isLoading} error={gaps.error} rows={gapRows} height={320} help="Same buckets; y = conversion rate of leads that experienced that gap at least once.">
          <VBars data={gapRows.map((g) => ({ bucket: g.bucket, conv: g.conv_rate ?? 0 }))} xKey="bucket" bars={[{ key: 'conv', label: 'Conv %' }]} format={(v) => fmtPct(v)} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Touch cadence heatmap" subtitle="day of week × hour (IST)" loading={heat.isLoading} error={heat.error} onRetry={heat.refetch} rows={heatRows} height={300}
          help="Touch volume by IST weekday and hour. Switch to 'converting touches' to see when the touches of eventually-converted leads happen."
          actions={<Segmented size="xs" value={heatMetric} onChange={setHeatMetric} options={[{ value: 'touches', label: 'All touches' }, { value: 'conv', label: 'Converting touches' }]} />}>
          <Heatmap rows={DOW} cols={HOURS} rowLabel="" colLabel="hour" get={(r, c) => { const v = heatIdx.get(`${DOW.indexOf(r)}|${Number(c)}`); return v ? (heatMetric === 'touches' ? v.t : v.c) : null; }} />
        </ChartCard>

        <ChartCard title="First touch → last touch transition matrix" subtitle="rows = first touch point, columns = last touch point" loading={trans.isLoading} error={trans.error} onRetry={trans.refetch} rows={tr} height={300}
          help="Leads with ≥1 touch, by their first touch point and their last pre-payment touch point (or last touch overall when not converted). Diagonal = single-channel journeys."
          actions={<Segmented size="xs" value={trMetric} onChange={setTrMetric} options={[{ value: 'leads', label: 'Leads' }, { value: 'conv', label: 'Conv %' }]} />}>
          <Heatmap rows={points} cols={points} rowLabel="first ↓ / last →" get={(r, c) => { const v = trIdx.get(`${r}|${c}`); return v ? (trMetric === 'leads' ? v.leads : v.conv_rate) : null; }} format={trMetric === 'leads' ? fmtInt : (v) => fmt1(v)} onClick={(r, c) => { toggleValue('first_touch_point', r); toggleValue('last_touch_point', c); }} />
        </ChartCard>
      </div>

      <ChartCard title={`Stale leads: open, last touch > ${staleDays} days ago`} subtitle={st ? `${fmtInt(st.total)} leads (${fmtInt(st.never_touched)} never touched)` : undefined} loading={stale.isLoading} error={stale.error} onRetry={stale.refetch} rows={(st?.rows ?? []) as Record<string, unknown>[]} height={420}
        help="Open = not converted and stage not in (Converted, Disqualified). Sorted oldest-touch first. Click a row for the full timeline. 'Never touched' leads sort first."
        actions={<Segmented size="xs" value={String(staleDays)} onChange={(v) => { setStaleDays(Number(v)); setStalePage(1); }} options={['3', '7', '14', '30'].map((d) => ({ value: d, label: `${d}d` }))} />}>
        <div className="flex h-full flex-col gap-2">
          <div className="flex flex-wrap gap-1 text-[11px]">{st?.by_owner.map((o) => <button key={o.owner_name} className="chip hover:border-accent" onClick={() => toggleValue('owner', o.owner_name)}>{o.owner_name}: {fmtInt(o.n)}</button>)}</div>
          <div className="min-h-0 flex-1 overflow-auto">
            <DataTable rows={(st?.rows ?? []) as Record<string, unknown>[]} compact onRowClick={(r) => setOpenLead(String(r.lead_id))}
              columns={[{ key: 'lead_name', header: 'Lead' }, { key: 'created_date', header: 'Created' }, { key: 'lead_source', header: 'Source' }, { key: 'lead_stage', header: 'Stage' }, { key: 'owner_name', header: 'Owner' }, { key: 'class_group', header: 'Class' }, { key: 'total_touches', header: 'Touches' }, { key: 'last_touch_at', header: 'Last touch', render: (v) => fmtDateTime(v as string) }, { key: 'last_touch_point', header: 'Last touch point' }, { key: 'days_since_touch', header: 'Days idle' }, { key: 'next_followup_due', header: 'Next follow-up' }]} />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span>page {st?.page ?? 1} of {st ? Math.max(1, Math.ceil(st.total / st.limit)) : 1}</span>
            <span className="flex gap-1"><button className="btn" disabled={stalePage <= 1} onClick={() => setStalePage((p) => p - 1)}>‹ Prev</button><button className="btn" disabled={!st || stalePage * st.limit >= st.total} onClick={() => setStalePage((p) => p + 1)}>Next ›</button></span>
          </div>
        </div>
      </ChartCard>
      <Note>Attribution note: only touches dated on or before the payment date count toward touches-to-convert and the curve; later touches are shown in timelines but never credited. See the "?" on each card for the exact SQL columns (analytics.mv_touch_base.is_pre_conversion).</Note>
      {openLead && <LeadDrawer leadId={openLead} onClose={() => setOpenLead(null)} />}
    </div>
  );
}

export type { ListDim };
