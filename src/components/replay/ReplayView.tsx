import { lazy, Suspense, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { DEFAULT_RACE_SLUG } from '@/types';
import { useRaceLab } from '@/store/raceLabStore';
import WhatIfDrawer from '@/components/WhatIfDrawer';
import { TimingTower } from './hud/TimingTower';
import { Scrubber } from './hud/Scrubber';
import { CameraSwitch, RaceSelector, TrackStatusBanner, TrackStatusVignette } from './hud/TopBar';
import { FocusPanel } from './hud/FocusPanel';
import { RaceToasts } from './hud/RaceToasts';
import { ViewToggles } from './hud/ViewToggles';
import { useReplayPrefs } from './lib/prefs';
import { decodeScenario, encodeScenario } from './lib/shareCodec';
import { frame, launchScenario } from './lib/frame';

const ReplayCanvas = lazy(() => import('./scene/ReplayCanvas'));

// dev-only handle for the screenshot / QA scripts (stripped from production builds)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __raceLab: unknown }).__raceLab = { useRaceLab, frame, useReplayPrefs };
}

/**
 * /replay/:raceSlug — 3D race replay + telemetry HUD + What-If ghost.
 *   ?autoplay=0      start paused (default: play on arrival)
 *   ?ghost=<code>    restore + auto-run a What-If scenario (see lib/shareCodec.ts)
 */
export default function ReplayView() {
  const { raceSlug } = useParams();
  const [params] = useSearchParams();
  const slug = raceSlug || DEFAULT_RACE_SLUG;
  const status = useRaceLab((s) => s.status);
  const error = useRaceLab((s) => s.error);
  const bundle = useRaceLab((s) => s.bundle);
  const timeline = useRaceLab((s) => s.timeline);
  const drawerOpen = useRaceLab((s) => s.drawerOpen);
  const ghostActive = useRaceLab((s) => !!s.ghost);
  const setDrawerOpen = useRaceLab((s) => s.setDrawerOpen);

  // load on entry / race switch
  useEffect(() => {
    let cancelled = false;
    const ghostCode = params.get('ghost');
    const autoplay = params.get('autoplay') !== '0';
    const lab = useRaceLab.getState();
    if (ghostCode && lab.slug === slug && lab.status === 'ready') lab.clearGhost();
    void lab.loadRace(slug, { autoplay }).then(() => {
      if (cancelled) return;
      const s = useRaceLab.getState();
      if (s.status !== 'ready' || s.slug !== slug || !ghostCode) return;
      const sc = decodeScenario(ghostCode, s.bundle);
      if (sc) launchScenario(sc, { openDrawer: true });
    });
    return () => {
      cancelled = true;
    };
    // params are read once per race entry on purpose
  }, [slug]);

  // keep ?ghost= in sync with the active scenario (no router re-render)
  useEffect(
    () =>
      useRaceLab.subscribe((s, prev) => {
        if (s.scenario === prev.scenario || s.status !== 'ready') return;
        const url = new URL(window.location.href);
        if (s.scenario) url.searchParams.set('ghost', encodeScenario(s.scenario));
        else url.searchParams.delete('ghost');
        url.searchParams.delete('autoplay');
        window.history.replaceState(window.history.state, '', url.toString().replace(/%3A/gi, ':'));
      }),
    [],
  );

  // pause + close on leave
  useEffect(
    () => () => {
      const s = useRaceLab.getState();
      s.pause();
      s.setDrawerOpen(false);
      document.body.style.cursor = '';
    },
    [],
  );

  // keyboard: space play/pause, ←/→ lap, 1/2/3 cameras, W what-if, A airflow, C auto-cut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const s = useRaceLab.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === '1') s.setCamera('broadcast');
      else if (e.key === '2') s.setCamera('topdown');
      else if (e.key === '3') s.setCamera('chase');
      else if (e.key.toLowerCase() === 'w') s.setDrawerOpen(!s.drawerOpen);
      else if (e.key.toLowerCase() === 'a') {
        const p = useReplayPrefs.getState();
        p.setAirflow(!p.airflow);
      } else if (e.key.toLowerCase() === 'c') {
        const p = useReplayPrefs.getState();
        p.setAutoCut(!p.autoCut);
      }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && s.timeline && el?.getAttribute('role') !== 'slider') {
        const lap = s.timeline.leaderLapAt(s.time) + (e.key === 'ArrowRight' ? 1 : -1);
        s.seekLap(Math.max(1, Math.min(s.timeline.totalLaps, lap)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ready = status === 'ready' && bundle && timeline && bundle.summary.slug === slug;

  return (
    <main className="theme-paper fixed inset-0 overflow-hidden bg-[#BFE3FF] text-ink">
      {/* 3D */}
      <div className="absolute inset-0">
        {bundle && timeline && (
          <Suspense fallback={null}>
            <ReplayCanvas bundle={bundle} timeline={timeline} />
          </Suspense>
        )}
      </div>

      {/* soft warm edge haze (HUD panels are opaque stickers, so no dark vignette needed) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_50%_45%,transparent_62%,rgba(255,246,224,.35))]" />
      {/* neutralised track (VSC / SC / red) tints the screen edge */}
      {ready && <TrackStatusVignette />}

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center font-mono text-sm font-semibold tracking-widest">
            {status === 'error' ? (
              <span className="inline-block rounded-md border-2 border-ink bg-[#D7102A] px-3 py-2 text-white shadow-sticker">Couldn’t load {slug}: {error}</span>
            ) : (
              <span className="inline-block -rotate-2 animate-pulse rounded-full border-2 border-ink bg-pop-sun px-4 py-2 text-ink shadow-sticker">Warming tyres · {slug.toUpperCase()}</span>
            )}
          </div>
        </div>
      )}

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-12 flex flex-col p-2 md:p-3">
        <div className="flex items-start gap-2">
          <div className="pointer-events-auto min-w-0 flex-1 md:flex-none">
            <RaceSelector />
          </div>
          <div className="hidden flex-1 flex-col items-center gap-2 pt-1 md:flex">
            {ready && <TrackStatusBanner />}
            {ready && <RaceToasts />}
          </div>
          <div className={`pointer-events-auto flex shrink-0 items-center gap-2 transition-[margin] duration-300 ${drawerOpen ? 'md:mr-[400px]' : ''}`}>
            <span className="hidden md:block">
              <ViewToggles />
            </span>
            <span className="hidden md:block">
              <CameraSwitch />
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              className={`flex h-9 items-center gap-1.5 rounded-lg border-2 border-ink px-3 font-display text-[15px] tracking-wider shadow-sticker-sm transition-transform hover:-translate-y-px ${
                drawerOpen ? 'bg-ink text-ghost' : 'bg-ghost text-ink'
              }`}
              aria-pressed={drawerOpen}
            >
              <Sparkles size={15} />
              WHAT IF?
              {ghostActive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
            </button>
          </div>
        </div>

        {ready && (
          <div className="mt-2 flex flex-col items-center gap-1.5 md:hidden">
            <TrackStatusBanner />
            <RaceToasts />
          </div>
        )}

        <div className="relative mt-2 flex min-h-0 flex-1 items-start justify-between gap-2">
          <div className="min-h-0">{ready && <TimingTower />}</div>
          <div className="pointer-events-auto flex flex-col gap-2 md:hidden">
            <CameraSwitch vertical />
            <ViewToggles vertical />
          </div>
        </div>

        {ready && (
          <div className={`mt-2 flex flex-col gap-2 transition-[margin] duration-300 ${drawerOpen ? 'md:mr-[400px]' : ''}`}>
            <div className="flex justify-end">
              <FocusPanel />
            </div>
            <Scrubber />
          </div>
        )}
      </div>

      <WhatIfDrawer />
    </main>
  );
}
