import { useMeta } from '../hooks/useMeta';
import { Icon, Popover, Skeleton } from './ui';
import type { delta as deltaFn } from '../lib/format';

type Delta = ReturnType<typeof deltaFn>;

export interface KpiCardProps {
  defKey: string;           // key into /api/meta definitions (drives the "?" popover)
  title: string;
  value: string;
  sub?: string;
  delta?: Delta;
  /** for "lower is better" metrics (days to convert) flip the colour */
  invert?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

export function KpiCard({ defKey, title, value, sub, delta, invert, loading, onClick }: KpiCardProps) {
  const { data: meta } = useMeta();
  const def = meta?.definitions.find((d) => d.key === defKey);
  const good = delta ? (delta.dir === 'up') !== !!invert : false;
  const color = !delta || delta.dir === 'flat' ? 'text-ink-3' : good ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#d03b3b]';
  return (
    <div className={`card flex min-h-[92px] flex-col justify-between gap-1 ${onClick ? 'cursor-pointer hover:border-accent' : ''}`} onClick={onClick}>
      <div className="flex items-start justify-between gap-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{title}</div>
        {def && (
          <Popover align="right" width="w-96" trigger={<button className="rounded p-0.5 text-ink-3 hover:text-ink" title="Definition" onClick={(e) => e.stopPropagation()}><Icon.Help /></button>}>
            <div onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 text-sm font-semibold">{def.title}</div>
              <p className="mb-2 text-xs leading-relaxed text-ink-2">{def.plain}</p>
              {def.deviation && <p className="mb-2 rounded bg-[#fab219]/15 px-2 py-1 text-[11px] text-ink-2">Note: {def.deviation}</p>}
              <pre className="max-h-48 overflow-auto rounded bg-surface-2 p-2 text-[10.5px] leading-snug text-ink-2">{def.sql}</pre>
            </div>
          </Popover>
        )}
      </div>
      {loading ? <Skeleton className="h-7 w-24" /> : <div className="text-2xl font-semibold tabular-nums text-ink">{value}</div>}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-ink-3">{sub}</span>
        {delta && <span className={`font-medium tabular-nums ${color}`} title="vs previous period">{delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '•'} {delta.text}</span>}
      </div>
    </div>
  );
}
