import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DEFAULT_RACE_SLUG } from '@/types';
import PitWallNav from '@/components/ui/PitWallNav';
import Loader from '@/components/ui/Loader';

// Each route is code-split so only one route's WebGL scene is mounted at a time.
const Landing = lazy(() => import('@/components/landing/Landing'));
const CircuitsPage = lazy(() => import('@/components/circuits/CircuitsPage'));
const ReplayView = lazy(() => import('@/components/replay/ReplayView'));
const SeasonPage = lazy(() => import('@/components/season/SeasonPage'));

export default function App() {
  return (
    <>
      <PitWallNav />
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/circuits" element={<CircuitsPage />} />
          <Route path="/replay" element={<Navigate to={`/replay/${DEFAULT_RACE_SLUG}?autoplay=1`} replace />} />
          <Route path="/replay/:raceSlug" element={<ReplayView />} />
          <Route path="/season" element={<SeasonPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
