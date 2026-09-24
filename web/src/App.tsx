import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Skeleton } from './components/ui';

const Overview = lazy(() => import('./pages/Overview'));
const TouchAttribution = lazy(() => import('./pages/TouchAttribution'));
const Converted = lazy(() => import('./pages/Converted'));
const Analysis = lazy(() => import('./pages/Analysis'));
const LeadExplorer = lazy(() => import('./pages/LeadExplorer'));

const Fallback = () => <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Suspense fallback={<Fallback />}><Overview /></Suspense>} />
        <Route path="first-touch" element={<Suspense fallback={<Fallback />}><TouchAttribution mode="first" /></Suspense>} />
        <Route path="last-touch" element={<Suspense fallback={<Fallback />}><TouchAttribution mode="last" /></Suspense>} />
        <Route path="converted" element={<Suspense fallback={<Fallback />}><Converted /></Suspense>} />
        <Route path="analysis" element={<Suspense fallback={<Fallback />}><Analysis /></Suspense>} />
        <Route path="leads" element={<Suspense fallback={<Fallback />}><LeadExplorer /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
