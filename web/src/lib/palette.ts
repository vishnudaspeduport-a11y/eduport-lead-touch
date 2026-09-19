/**
 * Validated reference palette (dataviz skill): categorical hues in FIXED
 * order (never cycled), one sequential hue (blue), a diverging pair, and a
 * reserved status set. Dark values are the same hues stepped for #1a1a19.
 */
import { useSyncExternalStore } from 'react';

export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const SERIES_DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
export const DIVERGING = { neg: '#e34948', mid_light: '#f0efec', mid_dark: '#383835', pos: '#2a78d6' };
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const INK = { light: { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' }, dark: { primary: '#ffffff', secondary: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835' } };

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
