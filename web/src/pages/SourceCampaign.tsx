import { useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import type { BreakdownResponse, BreakdownRow } from '../lib/types';
import { fmt2, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { Heatmap, QuadrantScatter, VBars } from '../charts';
import { Note, PageHeader, Segmented } from '../components/ui';
import { BREAKDOWN_COLS, BreakdownCard } from '../components/BreakdownCard';

export default function SourceCampaign() {
  const { params, toggleValue } = useFilters();
  const matrix = useApi<BreakdownResponse>('/breakdown', { ...params, dim: 'source', dim2: 'medium', limit: 12 });
  const [level, setLevel] = useState<'ad_campaign' | 'lead_ad_set' | 'lead_ad_name'>('ad_campaign');
  const drill = useApi<BreakdownResponse>('/breakdown', { ...params, dim: level, limit: 60 });
  const match = useApi<BreakdownResponse>('/breakdown', { ...params, dim: 'ad_campaign', dim2: 'class_match', limit: 30 });
  const paid = useApi<BreakdownResponse>('/breakdown', { ...params, dim: 'paid' });
  const scatterQ = useApi<BreakdownResponse>('/breakdown', { ...params, dim: 'lead_source', limit: 40 });
  const [mMetric, setMMetric] = useState<'leads' | 'conv_rate' | 'revenue' | 'avg_touches'>('leads');

  const mrows = matrix.data?.data.rows ?? [];
  const sources = useMemo(() => [...new Set(mrows.map((r) => r.key))].slice(0, 12), [mrows]);
  const mediums = useMemo(() => { const c = new Map<string, number>(); mrows.forEach((r) => c.set(r.key2 ?? '', (c.get(r.key2 ?? '') ?? 0) + r.leads)); return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 10); }, [mrows]);
  const midx = useMemo(() => new Map(mrows.map((r) => [`${r.key}|${r.key2 ?? ''}`, r])), [mrows]);

  const mismatch = useMemo(() => {
    const by = new Map<string, { campaign: string; leads: number; match: number; mismatch: number; unknown: number; converted: number }>();
    for (const r of match.data?.data.rows ?? []) {
      const o = by.get(r.key) ?? { campaign: r.key, leads: 0, match: 0, mismatch: 0, unknown: 0, converted: 0 };
      o.leads += r.leads; o.converted += r.converted;
      if (r.key2 === 'Match') o.match += r.leads; else if (r.key2 === 'Mismatch') o.mismatch += r.leads; else o.unknown += r.leads;
      by.set(r.key, o);
    }
    return [...by.values()].map((o) => ({ ...o, mismatch_pct: o.leads ? Math.round((o.mismatch / o.leads) * 1000) / 10 : 0, conv_rate: o.leads ? Math.round((o.converted / o.leads) * 10000) / 100 : 0 })).sort((a, b) => b.mismatch - a.mismatch);
  }, [match.data]);

  const scatter = useMemo(() => {
    const rows = (scatterQ.data?.data.rows ?? []).filter((r) => r.leads >= 20 && r.key !== '(null)');
    const xs = rows.map((r) => r.leads).sort((a, b) => a - b); const ys = rows.map((r) => r.conv_rate ?? 0).sort((a, b) => a - b);
    const med = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 0);
    const xMid = med(xs), yMid = med(ys);
    return { xMid, yMid, data: rows.map((r) => ({ key: r.key, x: r.leads, y: r.conv_rate ?? 0, z: r.revenue, quadrant: r.leads >= xMid ? ((r.conv_rate ?? 0) >= yMid ? 'Scale winners' : 'Fix or kill') : ((r.conv_rate ?? 0) >= yMid ? 'Nurture' : 'Low priority') })) };
  }, [scatterQ.data]);

  const paidRows = paid.data?.data.rows ?? [];
  const drillRows = drill.data?.data.rows ?? [];

  return (
    <div className="space-y-3">
      <PageHeader title="Source & campaign" subtitle="Which channels and campaigns bring leads that actually convert, and which attract the wrong class" />

      <div className="grid gap-3 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Source × Medium (touch level)" subtitle="click a cell to filter both" loading={matrix.isLoading} error={matrix.error} onRetry={matrix.refetch} rows={mrows as BreakdownRow[]} columns={[{ key: 'key', header: 'Source' }, { key: 'key2', header: 'Medium' }, ...BREAKDOWN_COLS.slice(1)]} height={270}
          help="Touch-level Source__c × Medium__c. Leads = distinct leads with such a touch; conv % = distinct converted leads (touched before payment) / leads; revenue = linear-attributed; avg touches = touches / leads."
          actions={<Segmented size="xs" value={mMetric} onChange={setMMetric} options={[{ value: 'leads', label: 'Leads' }, { value: 'conv_rate', label: 'Conv %' }, { value: 'revenue', label: 'Revenue' }, { value: 'avg_touches', label: 'Avg touches' }]} />}>
          <Heatmap rows={sources} cols={mediums} rowLabel="source ↓ / medium →" get={(r, c) => { const v = midx.get(`${r}|${c}`); return v ? ((v[mMetric] as number | null) ?? null) : null; }}
            format={mMetric === 'leads' ? fmtInt : mMetric === 'conv_rate' ? (v) => fmtPct(v) : mMetric === 'revenue' ? fmtINR : fmt2}
            onClick={(r, c) => { toggleValue('source', r); toggleValue('medium', c); }}
            cellTitle={(r, c, v) => { const x = midx.get(`${r}|${c}`); return x ? `${r} × ${c}\nleads ${fmtInt(x.leads)} · conv ${fmtPct(x.conv_rate)} · revenue ${fmtINR(x.revenue)} · rev/lead ${fmtINR(x.revenue_per_lead)} · avg touches ${fmt2(x.avg_touches)}` : `${r} × ${c}: ${v ?? '–'}`; }} />
        </ChartCard>

        <ChartCard title="Paid vs organic" subtitle="lead-level heuristic (see ?)" loading={paid.isLoading} error={paid.error} rows={paidRows} columns={BREAKDOWN_COLS} height={270}
          help="Paid = Lead_Source__c in (Fb Ad, Marketing Lead, Third Paid Party, Advertisement, Cbse 10 Marketing Lead, Google Ad, Meta Ad) OR any of gclid / fbclid / Meta_Lead_ID / Ad_Platform present. Defined once in analytics.is_paid_lead(). App addition - not in the Tableau workbook.">
          <VBars data={paidRows.map((r) => ({ key: r.key, leads: r.leads, converted: r.converted, conv: r.conv_rate }))} xKey="key" bars={[{ key: 'leads', label: 'Leads' }, { key: 'converted', label: 'Converted' }]} />
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Volume vs conversion: where to spend" subtitle="lead sources with ≥ 20 leads · medians split the quadrants · bubble = revenue" loading={scatterQ.isLoading} error={scatterQ.error} rows={scatter.data} height={290}
          help="x = leads (sqrt scale), y = conversion %. Quadrants at the medians: Scale winners (high volume, high conv), Fix or kill (high volume, low conv), Nurture (low volume, high conv), Low priority. Click a point to filter.">
          <QuadrantScatter data={scatter.data} xLabel="leads" yLabel="conv %" xMid={scatter.xMid} yMid={scatter.yMid} onClick={(k) => toggleValue('lead_source', k)} />
        </ChartCard>

        <ChartCard title="Ad class vs actual class: mismatch by campaign" subtitle="Ad_Class_Match__c on the lead" loading={match.isLoading} error={match.error} rows={mismatch} height={290}
          help="For each Ad_Campaign__c: how many leads Salesforce marked Match / Mismatch / Unknown between the class the ad targeted (Ad_Class__c) and the class the lead reported (Class__c). High mismatch % = the campaign attracts the wrong audience.">
          <DataTable rows={mismatch} compact initialSort={{ id: 'mismatch', desc: true }} onRowClick={(r) => toggleValue('ad_campaign', r.campaign)} columns={[
            { key: 'campaign', header: 'Ad campaign' }, { key: 'leads', header: 'Leads' }, { key: 'match', header: 'Match' }, { key: 'mismatch', header: 'Mismatch', bar: true }, { key: 'unknown', header: 'Unknown' },
            { key: 'mismatch_pct', header: 'Mismatch %', render: (v) => fmtPct(v as number) }, { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) }]} />
        </ChartCard>
      </div>

      <ChartCard title="Campaign → ad set → ad drill-down" subtitle="lead-level Ad_Campaign__c / Ad_Set__c / Ad_Name__c · click a row to filter, then step down a level" loading={drill.isLoading} error={drill.error} onRetry={drill.refetch} rows={drillRows} columns={BREAKDOWN_COLS} height={290}
        help="Each row is one campaign / ad set / ad as stamped on the lead by the ad platform sync. Clicking a row adds it as a filter; switch the level to see its children."
        actions={<Segmented size="xs" value={level} onChange={setLevel} options={[{ value: 'ad_campaign', label: 'Campaign' }, { value: 'lead_ad_set', label: 'Ad set' }, { value: 'lead_ad_name', label: 'Ad' }]} />}>
        <DataTable rows={drillRows} compact initialSort={{ id: 'leads', desc: true }} onRowClick={(r) => toggleValue(level as ListDim, r.key)} columns={BREAKDOWN_COLS} />
      </ChartCard>

      <div className="grid gap-3 xl:grid-cols-2">
        <BreakdownCard dim="campaign" title="Campaign (touch level)" limit={20} />
        <BreakdownCard dim="lead_source_detail" title="Lead source detail" limit={20} />
      </div>
      <Note>Lead-level fields (Ad_Campaign__c etc.) describe how the lead was created; touch-level fields (Campaign__c on Lead_Touch__c) describe every later interaction. Both are shown so campaign performance can be read at lead grain (no double counting) and at touch grain (journeys).</Note>
    </div>
  );
}
