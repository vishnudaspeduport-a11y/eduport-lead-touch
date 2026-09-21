import { NavLink, Outlet } from 'react-router-dom';
import { useMeta } from '../hooks/useMeta';
import { useTheme } from '../lib/palette';
import { fmtDateTime, fmtInt } from '../lib/format';
import { FilterBar } from './FilterBar';
import { ErrorBoundary, Icon, Popover } from './ui';
import { supabase } from '../lib/supabase';
import { SyncButton } from './SyncButton';

export const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/touches', label: 'Touch analysis' },
  { to: '/attribution', label: 'Attribution' },
  { to: '/sources', label: 'Source & campaign' },
  { to: '/funnel', label: 'Funnel & stage' },
  { to: '/cohorts', label: 'Cohorts & velocity' },
  { to: '/segments', label: 'Segments' },
  { to: '/team', label: 'Sales team' },
  { to: '/leads', label: 'Lead explorer' },
  { to: '/quality', label: 'Data quality' },
];

export function AppShell() {
  const { data: meta, error } = useMeta();
  const { dark, toggle } = useTheme();
  const asOf = meta?.dataAsOf;
  const stale = asOf?.refreshed_at ? Date.now() - new Date(asOf.refreshed_at).getTime() > 6 * 3600e3 : false;
  const syncErr = meta?.syncState.some((s) => s.last_error);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="border-b border-line px-4 py-3">
          <div className="text-sm font-bold tracking-tight">Eduport · Lead Touch</div>
          <div className="text-[11px] text-ink-3">Conversion analytics</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={{ pathname: n.to, search: window.location.search }} end={n.to === '/'}
              className={({ isActive }) => `block rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-accent/10 font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3 text-[11px] text-ink-3">
          {meta && <div className="truncate" title={meta.user.email}>{meta.user.email}</div>}
          {meta && <div>role: <span className="font-medium">{meta.user.role}</span> · v{meta.version}</div>}
          {supabase && <button className="mt-1 text-ink-3 hover:text-ink" onClick={() => supabase?.auth.signOut()}>Sign out</button>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
          <div className="flex items-center gap-2 md:hidden">
            <select className="input !py-1 text-xs" value={window.location.pathname} onChange={(e) => (window.location.href = e.target.value + window.location.search)}>
              {NAV.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-2">
            <Popover width="w-96" trigger={
              <button className={`chip ${stale || syncErr ? 'border-[#fab219] text-ink' : ''}`} title="Data freshness">
                <span className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-[#d03b3b]' : stale || syncErr ? 'bg-[#fab219]' : 'bg-[#0ca30c]'}`} />
                Data as of {asOf?.refreshed_at ? fmtDateTime(asOf.refreshed_at) : '…'}
              </button>}>
              <div className="space-y-2 text-xs">
                <div><span className="text-ink-3">Materialized views refreshed:</span> {fmtDateTime(asOf?.refreshed_at)}</div>
                <div><span className="text-ink-3">Salesforce watermark:</span> {fmtDateTime(asOf?.salesforce_as_of)}</div>
                <div><span className="text-ink-3">Last sync run:</span> {fmtDateTime(asOf?.last_sync_run_at)}</div>
                <div><span className="text-ink-3">Rows:</span> {fmtInt(asOf?.lead_rows)} leads · {fmtInt(asOf?.touch_rows)} touches</div>
                <table className="w-full text-[11px]"><tbody>
                  {meta?.syncState.map((s) => <tr key={s.object_name}><td className="pr-2 text-ink-3">{s.object_name}</td><td>{fmtDateTime(s.last_run_at)}</td><td className="text-right">{fmtInt(s.last_run_rows)}</td><td className="text-[#d03b3b]">{s.last_error ? '⚠' : ''}</td></tr>)}
                </tbody></table>
              </div>
            </Popover>
          </div>
          <div className="flex items-center gap-2">
            <SyncButton />
            <button className="btn" onClick={toggle} title="Toggle theme">{dark ? <Icon.Sun /> : <Icon.Moon />}</button>
          </div>
        </header>
        <main className="flex-1 px-4 pb-8 pt-0">
          <FilterBar />
          <ErrorBoundary label="page"><Outlet /></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
