import { NavLink, Outlet } from 'react-router-dom';
import { useMeta } from '../hooks/useMeta';
import { useTheme } from '../lib/palette';
import { fmtDateTime, fmtInt } from '../lib/format';
import { FilterBar } from './FilterBar';
import { ErrorBoundary, Icon, Popover } from './ui';
import { supabase } from '../lib/supabase';
import { SyncButton } from './SyncButton';

export const NAV = [
  { to: '/', label: 'Overview', icon: <Icon.Home /> },
  { to: '/leads', label: 'Lead explorer', icon: <Icon.Users /> },
  // parked (slow: they compute on the fly until rebuilt on request): /touches /attribution /sources /funnel /cohorts /segments /team /quality
];

export function AppShell() {
  const { data: meta, error } = useMeta();
  const { dark, toggle } = useTheme();
  const asOf = meta?.dataAsOf;
  const stale = asOf?.refreshed_at ? Date.now() - new Date(asOf.refreshed_at).getTime() > 6 * 3600e3 : false;
  const syncErr = meta?.syncState.some((s) => s.last_error);
  const initials = (meta?.user.email ?? 'bi').slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col p-3 pr-0 md:flex">
        <div className="card sticky top-3 flex h-[calc(100vh-1.5rem)] flex-col rounded-3xl p-3">
          <div className="flex items-center gap-2 px-1 pb-3 pt-1">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#5b6cff] via-[#8b5cf6] to-[#ff6fae] text-white shadow-md"><Icon.Spark /></span>
            <div>
              <div className="text-sm font-extrabold tracking-tight">Eduport</div>
              <div className="-mt-0.5 text-[10px] font-medium text-ink-3">Lead Touch analytics</div>
            </div>
          </div>
          <nav className="space-y-1">
            {NAV.map((n) => (
              <NavLink key={n.to} to={{ pathname: n.to, search: window.location.search }} end={n.to === '/'}
                className={({ isActive }) => `flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition ${isActive ? 'bg-ink text-surface shadow-md' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>
                <span className="opacity-80">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 px-3 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Coming next</div>
          <div className="mt-1 space-y-0.5 px-3 text-[11px] text-ink-3">
            {['Touch analysis', 'Attribution', 'Source & campaign', 'Sales team'].map((l) => <div key={l} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-line" />{l}</div>)}
          </div>

          <div className="mt-auto rounded-2xl bg-gradient-to-br from-[#6d5dfc] via-[#8b5cf6] to-[#ff6fae] p-3 text-white shadow-lg">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${error ? 'bg-red-300' : stale || syncErr ? 'bg-amber-300' : 'bg-emerald-300'} shadow`} />
              <div className="text-[10px] font-semibold uppercase tracking-wide text-white/80">Data freshness</div>
            </div>
            <div className="mt-1 text-sm font-bold leading-tight">{asOf?.refreshed_at ? fmtDateTime(asOf.refreshed_at) : 'loading…'}</div>
            <div className="mt-0.5 text-[10px] text-white/80">{fmtInt(asOf?.lead_rows)} leads · {fmtInt(asOf?.touch_rows)} touches</div>
            <div className="mt-2 text-[10px] text-white/80">Salesforce watermark {fmtDateTime(asOf?.salesforce_as_of)}</div>
          </div>
          <div className="mt-2 px-1 text-[10px] text-ink-3">
            {meta && <span>v{meta.version} · {meta.user.role}</span>}
            {supabase && <button className="ml-2 hover:text-ink" onClick={() => supabase?.auth.signOut()}>Sign out</button>}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
          <div className="flex items-center gap-2">
            <select className="input md:hidden" value={window.location.pathname} onChange={(e) => (window.location.href = e.target.value + window.location.search)}>
              {NAV.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
            </select>
            <Popover width="w-96" trigger={
              <button className={`chip !bg-surface/80 shadow-sm backdrop-blur ${stale || syncErr ? 'border-amber-400 text-ink' : ''}`} title="Data freshness">
                <span className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-red-500' : stale || syncErr ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                Data as of {asOf?.refreshed_at ? fmtDateTime(asOf.refreshed_at) : '…'}
              </button>}>
              <div className="space-y-2 text-xs">
                <div><span className="text-ink-3">Analytics table refreshed:</span> {fmtDateTime(asOf?.refreshed_at)}</div>
                <div><span className="text-ink-3">Salesforce watermark:</span> {fmtDateTime(asOf?.salesforce_as_of)}</div>
                <div><span className="text-ink-3">Last sync run:</span> {fmtDateTime(asOf?.last_sync_run_at)}</div>
                <div><span className="text-ink-3">Rows:</span> {fmtInt(asOf?.lead_rows)} leads · {fmtInt(asOf?.touch_rows)} touches</div>
                <table className="w-full text-[11px]"><tbody>
                  {meta?.syncState.map((s) => <tr key={s.object_name}><td className="pr-2 text-ink-3">{s.object_name}</td><td>{fmtDateTime(s.last_run_at)}</td><td className="text-right">{fmtInt(s.last_run_rows)}</td><td className="text-red-500">{s.last_error ? '⚠' : ''}</td></tr>)}
                </tbody></table>
              </div>
            </Popover>
          </div>
          <div className="flex items-center gap-2">
            <SyncButton />
            <button className="btn !px-2" onClick={toggle} title="Toggle theme">{dark ? <Icon.Sun /> : <Icon.Moon />}</button>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#ff9a6c] to-[#ff6fae] text-[11px] font-bold text-white shadow-md" title={meta?.user.email}>{initials}</span>
          </div>
        </header>
        <main className="flex-1 px-4 pb-8 pt-1">
          <FilterBar />
          <ErrorBoundary label="page"><Outlet /></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
