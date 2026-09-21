import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { onAuthError } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Supabase email login (same flow as the attrition app). Wraps the whole app:
 *  - no session      -> sign in / sign up form
 *  - API says 403    -> "Access pending" screen (email not on the allow-list)
 *  - otherwise       -> children
 * When the app is built without VITE_SUPABASE_URL (mock / dev), it renders children directly.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setPending(null); qc.clear(); });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  useEffect(() => onAuthError((status, msg) => {
    if (status === 403) setPending(msg);
    if (status === 401 && supabase) supabase.auth.signOut().catch(() => undefined);
  }), []);

  if (!supabase) return <>{children}</>;
  if (session === undefined) return <Center><div className="text-sm text-ink-3">Loading…</div></Center>;
  if (!session) return <Login />;
  if (pending) return <Pending message={pending} email={session.user.email ?? ''} onCheck={() => { setPending(null); qc.invalidateQueries(); }} />;
  return <>{children}</>;
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4"><div className="card w-full max-w-sm">{children}</div></div>;
}

function Login() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setMsg(data.session ? 'Signed up.' : 'Check your inbox and click the confirmation link, then sign in.');
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setMsg('Magic link sent. Open the e-mail on this device.');
      }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  return (
    <Center>
      <div className="mb-4">
        <div className="text-base font-bold">Eduport · Lead Touch</div>
        <div className="text-xs text-ink-3">Sign in with your work e-mail</div>
      </div>
      <form className="space-y-3" onSubmit={submit}>
        <input className="input w-full" type="email" required placeholder="you@eduport.ai" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        {mode !== 'magic' && <input className="input w-full" type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />}
        <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? '…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send magic link'}</button>
        {err && <div className="text-xs text-[#d03b3b]">{err}</div>}
        {msg && <div className="text-xs text-[#006300] dark:text-[#0ca30c]">{msg}</div>}
      </form>
      <div className="mt-4 flex justify-between text-[11px] text-ink-3">
        {mode !== 'signin' && <button className="hover:text-ink" onClick={() => setMode('signin')}>Sign in</button>}
        {mode !== 'signup' && <button className="hover:text-ink" onClick={() => setMode('signup')}>Create account</button>}
        {mode !== 'magic' && <button className="hover:text-ink" onClick={() => setMode('magic')}>E-mail me a link</button>}
      </div>
    </Center>
  );
}

function Pending({ message, email, onCheck }: { message: string; email: string; onCheck: () => void }) {
  return (
    <Center>
      <div className="mb-2 text-base font-bold">Access pending</div>
      <p className="text-xs text-ink-2">Signed in as <b>{email}</b>. {message}</p>
      <p className="mt-2 text-xs text-ink-3">Only @eduport.ai addresses are approved automatically. An admin can add other e-mails in Supabase (table <code>app_users</code>).</p>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" onClick={onCheck}>Check again</button>
        <button className="btn" onClick={() => supabase?.auth.signOut()}>Sign out</button>
      </div>
    </Center>
  );
}
