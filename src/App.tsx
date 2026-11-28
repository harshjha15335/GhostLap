import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { DEFAULT_RACE_SLUG } from '@/types';
import PitWallNav from '@/components/ui/PitWallNav';
import Loader from '@/components/ui/Loader';
import StickerCursor from '@/components/ui/StickerCursor';

// Each route is code-split so only one route's WebGL scene is mounted at a time.
const Landing = lazy(() => import('@/components/landing/Landing'));
const CircuitsPage = lazy(() => import('@/components/circuits/CircuitsPage'));
const ReplayView = lazy(() => import('@/components/replay/ReplayView'));
const TeamsPage = lazy(() => import('@/components/teams/TeamsPage'));
const TeamDetailPage = lazy(() => import('@/components/teams/TeamDetailPage'));
const DriversPage = lazy(() => import('@/components/drivers/DriversPage'));
const DriverDetailPage = lazy(() => import('@/components/drivers/DriverDetailPage'));

/** The old Season showroom: `/season?mode=teams&sel=<teamId>` deep links land on that team's page. */
function SeasonRedirect() {
  const [params] = useSearchParams();
  const sel = params.get('sel');
  if (params.get('mode') === 'teams' && sel) return <Navigate to={`/teams/${encodeURIComponent(sel)}`} replace />;
  return <Navigate to="/teams" replace />;
}

export default function App() {
  return (
    <>
      <PitWallNav />
      <StickerCursor />
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/circuits" element={<CircuitsPage />} />
          <Route path="/replay" element={<Navigate to={`/replay/${DEFAULT_RACE_SLUG}?autoplay=1`} replace />} />
          <Route path="/replay/:raceSlug" element={<ReplayView />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamDetailPage />} />
          <Route path="/season" element={<SeasonRedirect />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/drivers/:code" element={<DriverDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
