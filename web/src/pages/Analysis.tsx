import { useMemo, useRef, useState } from 'react';
import { authHeaders } from '../lib/api';
import { downloadText, fmtDateTime, fmtINR, fmtInt, fmtPct, toCsv } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { LeadDrawer } from '../components/LeadDrawer';
import { Icon, Note, PageHeader, Segmented, Skeleton } from '../components/ui';

type Row = Record<string, unknown>;
interface Parsed { headers: string[]; rows: Row[]; fileName: string; sheet: string }

const CHUNK = 1000;
const normalise = (v: unknown): string | null => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
const looksLikePhone = (name: string) => /phone|mobile|contact|number|whatsapp|ph\b/i.test(name);

/** Analysis: upload a spreadsheet with phone numbers, get every lead detail back. Parsed in the browser, nothing is stored anywhere. */
export default function Analysis() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [phoneCol, setPhoneCol] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Row[] | null>(null);
  const [view, setView] = useState<'all' | 'matched' | 'unmatched' | 'converted'>('all');
  const [leadId, setLeadId] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null); setResults(null); setBusy('Reading file…');
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheet], { defval: null, raw: false });
      if (!rows.length) throw new Error('The first sheet is empty');
      const headers = Object.keys(rows[0]);
      // pick the phone column: header name first, otherwise the column with most phone-looking values
      let best = headers.find(looksLikePhone) ?? '';
      if (!best) {
        let bestN = 0;
        for (const h of headers) { const n = rows.slice(0, 200).filter((r) => normalise(r[h])).length; if (n > bestN) { bestN = n; best = h; } }
      }
      setParsed({ headers, rows, fileName: file.name, sheet });
      setPhoneCol(best);
    } catch (e) { setError((e as Error).message); setParsed(null); }
    finally { setBusy(null); }
  };

  const phones = useMemo(() => {
    if (!parsed || !phoneCol) return [] as string[];
    return [...new Set(parsed.rows.map((r) => normalise(r[phoneCol])).filter((x): x is string => !!x))];
  }, [parsed, phoneCol]);
  const invalid = parsed && phoneCol ? parsed.rows.filter((r) => !normalise(r[phoneCol])).length : 0;

  const run = async () => {
    if (!parsed || !phones.length) return;
    setBusy(`Looking up ${fmtInt(phones.length)} numbers…`); setError(null); setResults(null);
    try {
      const out: Row[] = [];
      for (let i = 0; i < phones.length; i += CHUNK) {
        setBusy(`Looking up numbers ${fmtInt(i + 1)} to ${fmtInt(Math.min(i + CHUNK, phones.length))} of ${fmtInt(phones.length)}…`);
        const res = await fetch('/api/analysis/phones', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ phones: phones.slice(i, i + CHUNK) }) });
        const body = (await res.json()) as { data?: { rows: Row[] }; error?: { message: string } };
        if (!res.ok || !body.data) throw new Error(body.error?.message ?? res.statusText);
        out.push(...body.data.rows);
      }
      // attach the original spreadsheet columns to each result row (first input row per phone)
      const byPhone = new Map<string, Row>();
      for (const r of parsed.rows) { const k = normalise(r[phoneCol]); if (k && !byPhone.has(k)) byPhone.set(k, r); }
      const extra = parsed.headers.filter((h) => h !== phoneCol);
      setResults(out.map((r) => { const src = byPhone.get(String(r.phone_key)) ?? {}; const o: Row = { input_phone: src[phoneCol] ?? r.phone_key, ...r }; for (const h of extra) o[`file: ${h}`] = src[h]; return o; }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const summary = useMemo(() => {
    if (!results) return null;
    const phonesSeen = new Set(results.map((r) => r.phone_key));
    const matchedPhones = new Set(results.filter((r) => r.matched).map((r) => r.phone_key));
    const leads = results.filter((r) => r.matched);
    const converted = new Set(results.filter((r) => r.converted).map((r) => r.phone_key));
    const revenue = [...new Map(results.filter((r) => r.converted).map((r) => [r.phone_key, Number(r.revenue) || 0])).values()].reduce((a, b) => a + b, 0);
    return { phones: phonesSeen.size, matched: matchedPhones.size, leads: leads.length, converted: converted.size, revenue };
  }, [results]);

  const shown = useMemo(() => {
    if (!results) return [];
    if (view === 'matched') return results.filter((r) => r.matched);
    if (view === 'unmatched') return results.filter((r) => !r.matched);
    if (view === 'converted') return results.filter((r) => r.converted);
    return results;
  }, [results, view]);

  const extraCols: Col<Row>[] = (parsed?.headers ?? []).filter((h) => h !== phoneCol).map((h) => ({ key: `file: ${h}`, header: `File · ${h}` }));
  const cols: Col<Row>[] = [
    { key: 'input_phone', header: 'Phone (file)' }, { key: 'matched', header: 'Lead found', render: (v) => (v ? 'Yes' : 'No') },
    { key: 'lead_name', header: 'Lead ID' }, { key: 'eps_id', header: 'EPS ID', render: (v) => (v == null ? '–' : String(v)) },
    { key: 'first_name', header: 'Name', render: (v, r) => `${v ?? ''} ${r.last_name ?? ''}`.trim() || '–' }, { key: 'mobile', header: 'Mobile (Salesforce)' },
    { key: 'created_at', header: 'Created', render: (v) => fmtDateTime(v as string) }, { key: 'lead_stage', header: 'Stage' }, { key: 'class_raw', header: 'Class' },
    { key: 'lead_source', header: 'Lead source' }, { key: 'owner_name', header: 'Owner' }, { key: 'district', header: 'District' }, { key: 'lm_reason', header: 'LM reason' }, { key: 'best_ic_status', header: 'IC status' },
    { key: 'touches', header: 'Touches', align: 'right' }, { key: 'first_touch_point', header: 'First touch' }, { key: 'last_touch_point', header: 'Last touch' },
    { key: 'last_touch_at', header: 'Last touch time', render: (v) => fmtDateTime(v as string) }, { key: 'days_since_last_touch', header: 'Days since touch', align: 'right' }, { key: 'last_touch_staff', header: 'Last touch staff' },
    { key: 'touch_points', header: 'All touch points' }, { key: 'campaigns', header: 'Campaigns' },
    { key: 'converted', header: 'Converted', render: (v) => (v ? 'Yes' : 'No') }, { key: 'payments', header: 'Payments', align: 'right' }, { key: 'first_payment_date', header: 'First payment' }, { key: 'last_payment_date', header: 'Last payment' },
    { key: 'revenue', header: 'Revenue', render: (v) => (v == null ? '–' : fmtINR(v as number)) }, { key: 'courses', header: 'Courses bought' },
    { key: 'sf_is_converted', header: 'SF converted flag', render: (v) => (v ? 'Yes' : 'No') }, { key: 'is_duplicate', header: 'Duplicate', render: (v) => (v ? 'Yes' : 'No') }, { key: 'lead_id', header: 'Salesforce Id' },
    ...extraCols,
  ];

  return (
    <div className="space-y-2">
      <PageHeader title="Analysis" subtitle="upload a spreadsheet with phone numbers and get every lead's details back · the file is read in your browser and nothing is stored" />

      <div className="card flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        <button className="btn btn-dark" onClick={() => fileRef.current?.click()} disabled={!!busy}><Icon.Plus /> Choose Excel / CSV</button>
        <div className="rounded-2xl border-2 border-dashed border-line px-4 py-2 text-xs text-ink-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}>
          or drop the file here
        </div>
        {parsed && (
          <>
            <span className="chip"><b>{parsed.fileName}</b>&nbsp;· {fmtInt(parsed.rows.length)} rows · sheet "{parsed.sheet}"</span>
            <label className="flex items-center gap-1.5 text-xs text-ink-2">Phone column
              <select className="input !py-1" value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)}>
                {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <span className="text-xs text-ink-3">{fmtInt(phones.length)} unique valid numbers{invalid ? ` · ${fmtInt(invalid)} rows without a 10-digit number` : ''}</span>
            <button className="btn btn-primary" onClick={run} disabled={!!busy || !phones.length}><Icon.Chart /> Look up leads</button>
          </>
        )}
        {busy && <span className="text-xs text-ink-2">{busy}</span>}
        {error && <span className="text-xs text-red-500">⚠ {error}</span>}
      </div>

      {busy && !results && <Skeleton className="h-40" />}

      {summary && results && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([
              ['Numbers in file', fmtInt(summary.phones), 'unique, valid · click to show all', 'all'],
              ['Leads found', fmtInt(summary.matched), `${fmtPct(summary.phones ? Math.round((summary.matched / summary.phones) * 10000) / 100 : null)} of numbers · ${fmtInt(summary.leads)} lead records`, 'matched'],
              ['Not in Salesforce', fmtInt(summary.phones - summary.matched), 'no lead with this number', 'unmatched'],
              ['Converted', fmtInt(summary.converted), `${fmtPct(summary.phones ? Math.round((summary.converted / summary.phones) * 10000) / 100 : null)} of numbers have a valid payment`, 'converted'],
              ['Revenue', fmtINR(summary.revenue), 'all valid payments of these numbers', 'converted'],
            ] as [string, string, string, typeof view][]).map(([t, v, sub, target]) => (
              <button key={t} className={`card !p-2.5 text-left transition hover:border-accent/40 hover:shadow-pop ${view === target && t !== 'Revenue' ? 'border-accent ring-1 ring-accent/30' : ''}`} onClick={() => setView(target)} title="Click to filter the results">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{t}</div><div className="text-xl font-semibold tabular-nums">{v}</div><div className="text-[10px] text-ink-3">{sub}</div>
              </button>
            ))}
          </div>

          <div className="card flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold">Results</h3>
                <Segmented size="xs" value={view} onChange={setView} options={[{ value: 'all', label: `All (${fmtInt(results.length)})` }, { value: 'matched', label: 'Leads found' }, { value: 'unmatched', label: 'Not found' }, { value: 'converted', label: 'Converted' }]} />
                <span className="text-[11px] text-ink-3">one row per lead · a number with several leads appears more than once · click a row for the full record</span>
              </div>
              <button className="btn" onClick={() => downloadText(`analysis_${(parsed?.fileName ?? 'phones').replace(/\.[^.]+$/, '')}.csv`, toCsv(shown as Record<string, unknown>[], cols.map((c) => String(c.key))))}><Icon.Download /> CSV ({fmtInt(shown.length)} rows)</button>
            </div>
            <div style={{ height: 520 }}>
              <DataTable rows={shown} columns={cols} compact maxHeight="100%" rowKey={(r) => `${r.phone_key}-${r.lead_id ?? 'x'}`} onRowClick={(r) => { if (r.lead_id) setLeadId(String(r.lead_id)); }} />
            </div>
          </div>
        </>
      )}

      {leadId && <LeadDrawer leadId={leadId} onClose={() => setLeadId(null)} />}
      <Note>How it works: the spreadsheet is opened in your browser only. Phone numbers are normalised to their last 10 digits and sent to the dashboard's API in batches of 1,000, which looks them up in the same lead, payment and touch data as the rest of the dashboard and answers immediately. Neither the file nor the results are written to the database, so nothing needs deleting and no storage is used. Each lead sharing a number is returned; payments belong to the number, so they repeat on every lead of that number.</Note>
    </div>
  );
}
