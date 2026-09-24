/**
 * Validated reference palette (dataviz skill): categorical hues in FIXED
 * order (never cycled), one sequential hue (blue), a diverging pair, and a
 * reserved status set. Dark values are the same hues stepped for #1a1a19.
 */
import { useSyncExternalStore } from 'react';

export const SERIES_LIGHT = ['#f04e23', '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#059669', '#64748b'];
export const SERIES_DARK  = ['#ff7a50', '#60a5fa', '#2dd4bf', '#fbbf24', '#a78bfa', '#f472b6', '#34d399', '#94a3b8'];
export const SEQ = ['#fde8e1', '#fbd6c9', '#f9c2ae', '#f7ae93', '#f59a78', '#f3865e', '#f27246', '#f04e23', '#d9461f', '#c23e1b', '#ab3617', '#942f14', '#7d2710'];
export const DIVERGING = { neg: '#2563eb', mid_light: '#f1f2f5', mid_dark: '#3a3d4c', pos: '#f04e23' };
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
