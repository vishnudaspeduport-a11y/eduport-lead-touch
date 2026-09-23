import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Skeleton } from './components/ui';

const Overview = lazy(() => import('./pages/Overview'));
const TouchAttribution = lazy(() => import('./pages/TouchAttribution'));
const Converted = lazy(() => import('./pages/Converted'));
const TouchAnalysis = lazy(() => import('./pages/TouchAnalysis'));
const Attribution = lazy(() => import('./pages/Attribution'));
const SourceCampaign = lazy(() => import('./pages/SourceCampaign'));
const FunnelStage = lazy(() => import('./pages/FunnelStage'));
const Cohorts = lazy(() => import('./pages/Cohorts'));
const Segments = lazy(() => import('./pages/Segments'));
const SalesTeam = lazy(() => import('./pages/SalesTeam'));
const LeadExplorer = lazy(() => import('./pages/LeadExplorer'));
const DataQuality = lazy(() => import('./pages/DataQuality'));

const Fallback = () => <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Suspense fallback={<Fallback />}><Overview /></Suspense>} />
        <Route path="first-touch" element={<Suspense fallback={<Fallback />}><TouchAttribution mode="first" /></Suspense>} />
        <Route path="last-touch" element={<Suspense fallback={<Fallback />}><TouchAttribution mode="last" /></Suspense>} />
        <Route path="converted" element={<Suspense fallback={<Fallback />}><Converted /></Suspense>} />
        <Route path="touches" element={<Suspense fallback={<Fallback />}><TouchAnalysis /></Suspense>} />
        <Route path="attribution" element={<Suspense fallback={<Fallback />}><Attribution /></Suspense>} />
        <Route path="sources" element={<Suspense fallback={<Fallback />}><SourceCampaign /></Suspense>} />
        <Route path="funnel" element={<Suspense fallback={<Fallback />}><FunnelStage /></Suspense>} />
        <Route path="cohorts" element={<Suspense fallback={<Fallback />}><Cohorts /></Suspense>} />
        <Route path="segments" element={<Suspense fallback={<Fallback />}><Segments /></Suspense>} />
        <Route path="team" element={<Suspense fallback={<Fallback />}><SalesTeam /></Suspense>} />
        <Route path="leads" element={<Suspense fallback={<Fallback />}><LeadExplorer /></Suspense>} />
        <Route path="quality" element={<Suspense fallback={<Fallback />}><DataQuality /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
