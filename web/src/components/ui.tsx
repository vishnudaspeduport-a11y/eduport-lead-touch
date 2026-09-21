import React, { Component, type ReactNode, useEffect, useRef, useState } from 'react';

export function Skeleton({ className = 'h-6 w-full' }: { className?: string }) { return <div className={`skeleton ${className}`} />; }

export function EmptyState({ title = 'No data for this selection', hint }: { title?: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1 text-center">
      <div className="text-sm font-medium text-ink-2">{title}</div>
      {hint && <div className="max-w-xs text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[#d03b3b]/50 p-4 text-center">
      <div className="text-sm font-medium text-[#d03b3b]">⚠ Could not load</div>
      <div className="max-w-md break-words text-xs text-ink-3">{msg}</div>
      {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

interface EBState { error: Error | null }
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('ErrorBoundary', this.props.label, error); }
  render() {
    if (this.state.error) return <ErrorNote error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

/** Minimal popover anchored to its trigger */
export function Popover({ trigger, children, align = 'left', width = 'w-80' }: { trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div className={`absolute z-40 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${width} rounded-lg border border-line bg-surface p-3 shadow-xl`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'sm' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; title?: string }[]; size?: 'sm' | 'xs' }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button key={o.value} title={o.title} onClick={() => onChange(o.value)}
          className={`rounded px-2 ${size === 'xs' ? 'py-0.5 text-[11px]' : 'py-1 text-xs'} font-medium ${value === o.value ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-ink-2" title={title}>
      <span onClick={() => onChange(!checked)} className={`relative inline-block h-4 w-7 rounded-full transition ${checked ? 'bg-accent' : 'bg-ink/20'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${checked ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {label}
    </label>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] leading-snug text-ink-2">{children}</div>;
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h1 className="text-base font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-[11px] text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export const Icon = {
  Help: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" /></svg>,
  Table: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>,
  Chart: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 14v4M12 9v9M17 5v13" /></svg>,
  Download: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3" /></svg>,
  Close: () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  Sun: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  Moon: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>,
  Plus: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>,
  Chevron: ({ open }: { open?: boolean }) => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="m9 6 6 6-6 6" /></svg>,
};

export function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="rounded border border-line bg-surface-2 px-1 text-[10px] text-ink-3">{children}</kbd>; }
