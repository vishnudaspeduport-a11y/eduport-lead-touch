/**
 * Validated reference palette (dataviz skill): categorical hues in FIXED
 * order (never cycled), one sequential hue (blue), a diverging pair, and a
 * reserved status set. Dark values are the same hues stepped for #1a1a19.
 */
import { useSyncExternalStore } from 'react';

export const SERIES_LIGHT = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#059669', '#7c3aed', '#ea580c', '#64748b'];
export const SERIES_DARK  = ['#818cf8', '#2dd4bf', '#fbbf24', '#f472b6', '#34d399', '#a78bfa', '#fb923c', '#94a3b8'];
export const SEQ = ['#e4e7ff', '#d3d8ff', '#c1c8ff', '#adb7ff', '#98a5ff', '#8393ff', '#6e80ff', '#5b6cff', '#4f5fe6', '#4352cc', '#3846b3', '#2e3a99', '#242e80'];
export const DIVERGING = { neg: '#ef4444', mid_light: '#eef0f8', mid_dark: '#3a3d5c', pos: '#5b6cff' };
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const INK = { light: { primary: '#0f172a', secondary: '#475569', muted: '#64748b', grid: '#e2e8f0', axis: '#cbd5e1' }, dark: { primary: '#f6f6fc', secondary: '#bec1d8', muted: '#8488a5', grid: '#32344c', axis: '#454866' } };

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mo = new MutationObserver(() => cb());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => { listeners.delete(cb); mo.disconnect(); };
}
const isDark = () => document.documentElement.classList.contains('dark');

export function useTheme() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const toggle = () => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('lt-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
    listeners.forEach((l) => l());
  };
  return { dark, toggle, series: dark ? SERIES_DARK : SERIES_LIGHT, ink: dark ? INK.dark : INK.light, midpoint: dark ? DIVERGING.mid_dark : DIVERGING.mid_light };
}

/** sequential color for 0..1 */
export function seqColor(t: number, dark = false): string {
  if (Number.isNaN(t)) return dark ? '#2c2c2a' : '#f0efec';
  const i = Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))));
  return SEQ[i];
}
/** text color that is legible on a sequential step */
export const seqInk = (t: number) => (t > 0.55 ? '#ffffff' : '#0b0b0b');
