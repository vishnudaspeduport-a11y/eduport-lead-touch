import { useState, type ReactNode } from 'react';
import { useApi } from '../lib/api';
import { useFilters, type ListDim } from '../lib/filters';
import { fmtINR, fmtInt, fmtPct, fmtDateTime } from '../lib/format';
import { ChartCard } from '../components/ChartCard';
import { DataTable, type Col } from '../components/DataTable';
import { DailyLines, Donut, HBars } from '../charts';
import { CardSearch, Icon, Note, PageHeader, Popover, Skeleton } from '../components/ui';
import { DrillDrawer, type Drill } from '../components/DrillDrawer';

interface Dim { key: string; users: number; touches: number; revenue: number; new_users: number; share_pct: number | null }
interface Resp {
  period: { from: string; to: string };
  kpis: { users: number; new_users: number; no_touch: number; no_lead: number; payments_all: number; revenue_all: number; touches: number; no_touch_pct: number | null; no_lead_pct: number | null; converted_leads_touch_rule: number };
  by_stage: Dim[]; by_last_touch_point: Dim[]; by_last_source: Dim[]; by_last_medium: Dim[]; by_last_campaign: Dim[]; by_last_staff: Dim[]; by_course: Dim[]; by_grade: Dim[];
  daily: { d: string; users: number; payments: number; revenue: number }[];
  grades: string[];
  definitions: Record<string, string>;
}
type Row = Record<string, unknown>;

const yesNo = (v: unknown) => (v ? 'Yes' : 'No');
const USER_COLS: Col<Row>[] = [
  { key: 'user_id', header: 'EPS ID' }, { key: 'lead_name', header: 'Lead ID' },
  { key: 'first_name', header: 'Name', render: (v, r) => `${v ?? ''} ${r.last_name ?? ''}`.trim() || '–' }, { key: 'mobile', header: 'Phone' },
  { key: 'lead_stage', header: 'Stage' }, { key: 'class_raw', header: 'Lead class' }, { key: 'grades', header: 'Purchased grade' }, { key: 'courses', header: 'Course / batch' },
  { key: 'payments', header: 'Payments', align: 'right' }, { key: 'first_payment_date', header: 'First payment' }, { key: 'last_payment_date', header: 'Last payment' },
  { key: 'revenue', header: 'Revenue', render: (v) => fmtINR(v as number) },
  { key: 'last_touch_point', header: 'Last touch point' }, { key: 'last_touch_source', header: 'Last touch source' }, { key: 'last_touch_medium', header: 'Last touch medium' },
  { key: 'last_touch_campaign', header: 'Last touch campaign' }, { key: 'last_touch_staff', header: 'Last touch staff' },
  { key: 'last_touch_at', header: 'Last touch time', render: (v) => fmtDateTime(v as string) }, { key: 'touches_before_payment', header: 'Touches before payment', align: 'right' },
  { key: 'lead_source', header: 'Lead source' }, { key: 'owner_name', header: 'Owner' }, { key: 'no_lead', header: 'No lead', render: yesNo }, { key: 'lead_id', header: 'Salesforce Id' },
];
const USER_SORTS: [string, string][] = [['last_payment_date', 'Last payment'], ['first_payment_date', 'First payment'], ['revenue', 'Revenue'], ['payments', 'Payments'], ['touches_before_payment', 'Touches before payment'], ['last_touch_at', 'Last touch time'], ['lead_name', 'Lead ID'], ['lead_stage', 'Stage']];

function Kpi({ title, value, sub, def, tone, icon, onClick }: { title: string; value: string; sub?: string; def?: string; tone: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <div className={`card ${tone} relative flex min-h-[84px] flex-col justify-between gap-1 overflow-hidden !p-2.5 ${onClick ? 'cursor-pointer transition hover:border-accent/40 hover:shadow-pop' : ''}`} onClick={onClick} title={onClick ? 'Click to see the users' : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-tone text-tone">{icon}</span>
          <div className="line-clamp-2 text-[10px] font-medium uppercase leading-tight tracking-wider text-ink-3" title={title}>{title}</div>
        </div>
        {def && <span onClick={(e) => e.stopPropagation()}><Popover align="right" width="w-80" trigger={<button className="relative rounded p-0.5 text-ink-3 hover:text-ink"><Icon.Help /></button>}><div className="text-xs leading-relaxed text-ink-2">{def}</div></Popover></span>}
      </div>
      <div>
        <div className="text-xl font-semibold leading-none tabular-nums tracking-tight">{value}</div>
        {sub && <div className="mt-1 truncate text-[10px] text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}

type ConvCardOpts = { filterDim?: ListDim; asTable?: boolean; height?: number; limit?: number; help?: string; cols?: Col<Dim>[] };

function ConvCard({ title, rows, tone, opts, cols, loading, error, onRetry, help, selected, onRow, onApply }: {
  title: string; rows: Dim[] | undefined; tone: string; opts: ConvCardOpts; cols: Col<Dim>[]; loading: boolean; error: unknown; onRetry: () => void; help: string;
  selected: string[]; onRow: (key: string) => void; onApply?: (keys: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const s = search.trim().toLowerCase();
  const all = rows ?? [];
  const filtered = s ? all.filter((r) => r.key.toLowerCase().includes(s)) : all;
  const data = filtered.slice(0, opts.limit ?? 14);
  return (
    <ChartCard title={title} tone={tone} subtitle={rows ? `${fmtInt(filtered.reduce((x, r) => x + r.users, 0))} users${s ? ` in ${filtered.length} matching rows` : ''} · ${opts.filterDim ? 'click a row to filter every card' : 'click a row for the users'}` : undefined}
      loading={loading} error={error} onRetry={onRetry} rows={filtered} columns={cols} height={opts.height ?? 280} help={help}
      actions={<CardSearch value={search} onChange={setSearch} count={filtered.length} onApply={onApply ? () => onApply(filtered.map((r) => r.key)) : undefined} />}>
      {opts.asTable
        ? <DataTable rows={filtered} compact maxHeight="100%" initialSort={{ id: 'users', desc: true }} onRowClick={(r) => onRow(r.key)} columns={cols} />
        : <HBars colorful data={data.map((r) => ({ key: r.key, value: r.users, secondary: r.share_pct, selected: selected.includes(r.key), extra: { Revenue: fmtINR(r.revenue), 'Touches before payment': fmtInt(r.touches) } }))}
            valueLabel="Converted (users)" secondaryLabel="Share" onClick={onRow} />}
    </ChartCard>
  );
}

/** Tableau "Lead Touch - Converted": paying users by payment date, credited to their last touch before the payment. */
export default function Converted() {
  const { f, params, toggleValue, setList } = useFilters();
  const [grade, setGrade] = useState<string>('');
  const q = useApi<Resp>('/converted', { ...params, grade });
  const d = q.data?.data;
  const k = d?.kpis;
  const def = d?.definitions ?? {};
  const [drill, setDrill] = useState<Drill | null>(null);
  const open = (title: string, dim?: string, value?: string, subtitle?: string) =>
    setDrill({ metric: 'leads', title, dim, value, subtitle: subtitle ?? 'paying users with a valid payment in the window · click a row for the lead record', path: '/converted/users', csvPath: '/converted/users.csv', columns: USER_COLS, sortOptions: USER_SORTS, defaultSort: 'last_payment_date', extra: grade ? { grade } : undefined, noun: 'users' });

  const dimCols: Col<Dim>[] = [
    { key: 'key', header: '' }, { key: 'users', header: 'Converted (users)', bar: true }, { key: 'share_pct', header: 'Share', render: (v) => fmtPct(v as number) },
    { key: 'new_users', header: 'New customers' }, { key: 'touches', header: 'Touches before payment' }, { key: 'revenue', header: 'Revenue', render: (v) => fmtINR(v as number) },
  ];
  const payCols: Col<Dim>[] = [
    { key: 'key', header: '' }, { key: 'users', header: 'Converted (users)', bar: true }, { key: 'touches', header: 'Payments' }, { key: 'revenue', header: 'Revenue (window)', render: (v) => fmtINR(v as number) },
  ];

  const card = (title: string, rows: Dim[] | undefined, drillDim: string, tone: string, opts: ConvCardOpts = {}) => (
    <ConvCard key={title} title={title} rows={rows} tone={tone} opts={opts} cols={opts.cols ?? dimCols} loading={q.isLoading} error={q.error} onRetry={q.refetch}
      help={opts.help ?? `${title}. ${def.credit ?? ''}`} selected={opts.filterDim ? (f.lists[opts.filterDim] ?? []) : []}
      onRow={(key) => (opts.filterDim ? toggleValue(opts.filterDim, key) : open(`${title} · ${key}`, drillDim, key))}
      onApply={opts.filterDim ? (keys) => setList(opts.filterDim!, keys) : undefined} />
  );

  return (
    <div className="space-y-2">
      <PageHeader title="Converted" subtitle={`payment date ${f.from} → ${f.to} · same definitions as the Tableau "Lead Touch - Converted" dashboard (paying users, credited to the last touch before payment)`}
        right={
          <label className="flex items-center gap-1.5 text-xs text-ink-2">Purchased grade
            <select className="input !py-1" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">All grades</option>
              {(d?.grades ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>} />
      {q.error && <Note>⚠ {q.error.message}</Note>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {q.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
        {k && <>
          <Kpi tone="tone-orange" icon={<Icon.Check />} title="Converted (users)" value={fmtInt(k.users)} sub={`${fmtInt(k.payments_all)} payments in the window`} def={def.users} onClick={() => open('Converted users')} />
          <Kpi tone="tone-green" icon={<Icon.Spark />} title="New customers" value={fmtInt(k.new_users)} sub={`${fmtPct(k.users ? Math.round((k.new_users / k.users) * 10000) / 100 : null)} first ever payment in window`} def={def.new_users} />
          <Kpi tone="tone-violet" icon={<Icon.Avg />} title="Revenue (window)" value={fmtINR(k.revenue_all)} sub="payment amounts dated in the window" def={def.revenue} />
          <Kpi tone="tone-pink" icon={<Icon.Touch />} title="No touch before payment" value={fmtInt(k.no_touch)} sub={`${fmtPct(k.no_touch_pct)} of users`} def={def.no_touch} onClick={() => open('No touch before payment', 'last_touch_point', 'No Touch Before Payment')} />
          <Kpi tone="tone-slate" icon={<Icon.Users />} title="No Salesforce lead" value={fmtInt(k.no_lead)} sub={`${fmtPct(k.no_lead_pct)} of users`} def={def.no_lead} onClick={() => open('Users with no Salesforce lead', 'lead_stage', '(null)')} />
          <Kpi tone="tone-blue" icon={<Icon.Calendar />} title="Total converted (touch rule)" value={fmtInt(k.converted_leads_touch_rule)} sub="Overview rule, same dates as touch dates" def={def.converted_leads_touch_rule} />
        </>}
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <ChartCard title="Lead stage distribution" tone="tone-blue" subtitle="converted users by lead stage · click a slice to filter" loading={q.isLoading} error={q.error} rows={d?.by_stage ?? []} columns={dimCols} height={260} help={def.stage}>
          <Donut data={(d?.by_stage ?? []).map((s) => ({ key: s.key === '(null)' ? 'No Salesforce lead' : s.key, value: s.users, selected: (f.lists.lead_stage ?? []).includes(s.key) }))} valueLabel="Converted (users)" centerLabel="users" onClick={(key) => toggleValue('lead_stage', key === 'No Salesforce lead' ? '(null)' : key)} />
        </ChartCard>
        {card('Touch point analysis (converted leads)', d?.by_last_touch_point, 'last_touch_point', 'tone-teal', { filterDim: 'touch_point', height: 260 })}
        {card('Class wise conversion (purchased course)', d?.by_course, 'course', 'tone-violet', { asTable: true, cols: payCols, help: def.course })}
        {card('Purchased grade', d?.by_grade, 'grade', 'tone-amber', { cols: payCols, help: def.grade, height: 280 })}
        {card('Staff-wise (last touch)', d?.by_last_staff, 'last_touch_staff', 'tone-pink', { filterDim: 'staff', asTable: true })}
        {card('Lead source distribution (last touch)', d?.by_last_source, 'last_touch_source', 'tone-orange', { filterDim: 'source', asTable: true })}
        {card('Medium wise conversion (last touch)', d?.by_last_medium, 'last_touch_medium', 'tone-green', { filterDim: 'medium', asTable: true })}
        {card('Campaign wise conversion (last touch)', d?.by_last_campaign, 'last_touch_campaign', 'tone-blue', { filterDim: 'campaign', asTable: true })}
        <ChartCard title="Payments per day" tone="tone-teal" subtitle="paying users and payments by payment date" loading={q.isLoading} error={q.error} rows={d?.daily ?? []} height={260} className="xl:col-span-2">
          <DailyLines data={(d?.daily ?? []).map((r) => ({ d: r.d.slice(5), users: r.users, payments: r.payments }))} xKey="d" lines={[{ key: 'users', label: 'Users' }, { key: 'payments', label: 'Payments' }]} />
        </ChartCard>
      </div>

      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
      <Note>This page counts <b>paying app users</b>, not Salesforce leads, and its date range is the <b>payment date</b>, whatever the basis switch says. Each user is credited to one touch: the latest touch dated on or before the last payment day, across every lead sharing the phone; users without such a touch are grouped as "No Touch Before Payment", and users whose phone matches no lead as "No Salesforce lead". Purchased grade and course come from the batch that was bought, so they can differ from the lead's class. The Class Group chip in the filter bar applies to the lead's class; use the Purchased grade selector above for the workbook's grade filter.</Note>
    </div>
  );
}
