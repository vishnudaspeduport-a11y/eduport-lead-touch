import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/ui';

/**
 * Every CSV download goes through this gate: a small dialog asks for the shared export password, then runs the
 * download with it. Server-streamed files send the password in the X-Export-Password header; files built in the
 * browser verify it through POST /api/export/verify first. The password is never kept: the next download asks again.
 */
export interface ExportRequest {
  /** what is being downloaded, shown in the dialog */
  title: string;
  /** performs the download; throws { status: 401 } for a wrong password, { status: 403 } when none is set */
  run: (password: string) => Promise<void>;
}

const Ctx = createContext<(r: ExportRequest) => void>(() => undefined);
export const useExportGate = () => useContext(Ctx);

/** POST /export/verify: for CSVs assembled in the browser (the data is already on screen; the gate is still enforced). */
export async function verifyExportPassword(password: string, file: string): Promise<void> {
  const res = await fetch('/api/export/verify', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ password, file }) });
  if (res.ok) return;
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  throw Object.assign(new Error(j.error?.message ?? res.statusText), { status: res.status });
}

export function ExportGateProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ExportRequest | null>(null);
  const request = useCallback((r: ExportRequest) => setReq(r), []);
  return (
    <Ctx.Provider value={request}>
      {children}
      {req && <ExportDialog req={req} onClose={() => setReq(null)} />}
    </Ctx.Provider>
  );
}

function ExportDialog({ req, onClose }: { req: ExportRequest; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose, busy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true); setErr(null);
    try { await req.run(password); onClose(); }
    catch (x) {
      const s = (x as { status?: number }).status;
      setErr(s === 401 ? 'Wrong export password' : (x as Error).message || 'Download failed');
      if (s === 401) { setPassword(''); input.current?.focus(); }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-4" onClick={() => { if (!busy) onClose(); }}>
      <form className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Export password</h3>
          <button type="button" className="rounded p-1 text-ink-3 hover:text-ink" onClick={onClose} disabled={busy}><Icon.Close /></button>
        </div>
        <div className="text-xs text-ink-2">Downloading <b className="text-ink">{req.title}</b>. Every CSV download asks for the export password; ask an admin if you do not have it.</div>
        <div className="flex gap-1.5">
          <input ref={input} className="input w-full font-mono" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="Export password" disabled={busy} />
          <button type="button" className="btn" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        {busy && <div className="text-[11px] text-ink-3">Building the file on the server. Large exports take a minute or two on the current database; keep this tab open.</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !password}><Icon.Download /> {busy ? 'Preparing…' : 'Download'}</button>
        </div>
      </form>
    </div>
  );
}
