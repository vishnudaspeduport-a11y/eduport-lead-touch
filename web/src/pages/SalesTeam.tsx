import { useState } from 'react';
import { useApi } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { TeamResponse } from '../lib/types';
import { fmt1, fmt2, fmtHours, fmtINR, fmtInt, fmtPct } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { HBars } from '../charts';
import { Note, PageHeader, Segmented } from '../components/ui';

type M = 'conv_rate' | 'contact_rate' | 'median_response_hours' | 'revenue_per_lead' | 'leads' | 'avg_touches';

export default function SalesTeam() {
  const { params, toggleValue } = useFilters();
  const q = useApi<TeamResponse>('/team', params);
  const d = q.data?.data;
  const [metric, setMetric] = useState<M>('conv_rate');
  const owners = (d?.owners ?? []).filter((o) => o.leads >= 20);
  const fmt = metric === 'conv_rate' || metric === 'contact_rate' ? (v: number) => fmtPct(v) : metric === 'median_response_hours' ? fmtHours : metric === 'revenue_per_lead' ? fmtINR : metric === 'avg_touches' ? fmt2 : fmtInt;
  const sorted = [...owners].sort((a, b) => (metric === 'median_response_hours' ? (a[metric] ?? 1e9) - (b[metric] ?? 1e9) : ((b[metric] as number) ?? -1) - ((a[metric] as number) ?? -1))).slice(0, 25);
  return (
    <div className="space-y-4">
      <PageHeader title="Sales team" subtitle="Per owner: leads handled, contact rate, touches, response time, conversion, revenue and call stats" />
      <Note><b>Fairness note.</b> {d?.fairness_note ?? 'Rates are normalised by leads assigned, not raw conversions.'} Owners with fewer than 20 leads in the window are hidden from the ranking chart but stay in the table.</Note>

      <ChartCard title="Owner ranking" subtitle="owners with ≥ 20 leads · click to filter" loading={q.isLoading} error={q.error} onRetry={q.refetch} rows={d?.owners ?? []} height={Math.max(300, 24 * Math.min(25, sorted.length) + 40)}
        help="conv % = converted / leads assigned; contact rate = leads with ≥1 touch / leads; response = median hours from lead creation to first touch; revenue/lead = valid payment total / leads assigned."
        actions={<Segmented size="xs" value={metric} onChange={setMetric} options={[{ value: 'conv_rate', label: 'Conv %' }, { value: 'contact_rate', label: 'Contact %' }, { value: 'median_response_hours', label: 'Response' }, { value: 'revenue_per_lead', label: 'Rev/lead' }, { value: 'avg_touches', label: 'Avg touches' }, { value: 'leads', label: 'Leads' }]} />}>
        <HBars data={sorted.map((o) => ({ key: o.owner_name, value: (o[metric] as number | null) ?? 0, secondary: o.leads, extra: { Converted: fmtInt(o.converted), 'Conv %': fmtPct(o.conv_rate), Contact: fmtPct(o.contact_rate) } }))} format={fmt} valueLabel={metric} secondaryLabel="Leads" secondaryFormat={fmtInt} onClick={(k) => toggleValue('owner', k)} />
      </ChartCard>

      <ChartCard title="Owner detail" loading={q.isLoading} error={q.error} rows={d?.owners ?? []} height={520} help="Call stats come from Task rows joined to the lead by normalised phone: attempts = tasks that look like calls, connected = Call_Status__c = ANSWERED or duration > 0.">
        <DataTable rows={d?.owners ?? []} compact initialSort={{ id: 'leads', desc: true }} onRowClick={(r) => toggleValue('owner', r.owner_name)} columns={[
          { key: 'owner_name', header: 'Owner' }, { key: 'leads', header: 'Leads', bar: true }, { key: 'contact_rate', header: 'Contact %', render: (v) => fmtPct(v as number) },
          { key: 'touches', header: 'Touches' }, { key: 'avg_touches', header: 'Avg touches', render: (v) => fmt2(v as number) },
          { key: 'median_response_hours', header: 'Median response', render: (v) => fmtHours(v as number) },
          { key: 'converted', header: 'Converted' }, { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) },
          { key: 'revenue', header: 'Revenue', render: (v) => fmtINR(v as number) }, { key: 'revenue_per_lead', header: 'Rev/lead', render: (v) => fmtINR(v as number) },
          { key: 'call_attempts', header: 'Call attempts' }, { key: 'calls_connected', header: 'Connected' }, { key: 'connect_rate', header: 'Connect %', render: (v) => fmtPct(v as number) },
          { key: 'avg_call_seconds', header: 'Avg call (s)', render: (v) => fmt1(v as number) }, { key: 'open_leads', header: 'Open' }, { key: 'stale_7d', header: 'Stale 7d' },
        ]} />
      </ChartCard>

      <ChartCard title="Touch staff (Lead_Touch__c.Staff__c)" subtitle="who made the touches" loading={q.isLoading} error={q.error} rows={d?.staff ?? []} height={380}
        help="Touches grouped by the Staff__c stamped on the touch. Conversions are last-touch and linear credits; conv % = distinct converted leads touched / distinct leads touched.">
        <DataTable rows={d?.staff ?? []} compact initialSort={{ id: 'touches', desc: true }} onRowClick={(r) => toggleValue('staff', r.staff)} columns={[
          { key: 'staff', header: 'Staff' }, { key: 'touches', header: 'Touches', bar: true }, { key: 'leads', header: 'Leads touched' }, { key: 'touches_per_lead', header: 'Touches / lead', render: (v) => fmt2(v as number) },
          { key: 'converted_leads', header: 'Converted leads' }, { key: 'conv_rate', header: 'Conv %', render: (v) => fmtPct(v as number) },
          { key: 'conv_last', header: 'Last-touch credit', render: (v) => fmt1(v as number) }, { key: 'conv_linear', header: 'Linear credit', render: (v) => fmt1(v as number) }, { key: 'revenue_linear', header: 'Revenue (linear)', render: (v) => fmtINR(v as number) },
        ]} />
      </ChartCard>
    </div>
  );
}
