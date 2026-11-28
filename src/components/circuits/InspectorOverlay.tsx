import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, X } from 'lucide-react';
import type { RaceBundle, RaceSummary } from '@/types';
import { useDriverLookup } from '@/store/seasonStore';
import { loadRace } from '@/engine/dataLoader';
import Loader from '@/components/ui/Loader';
import { DriverChip, StatusBadge, fmtDate } from '@/components/ui/primitives';
import { SECTOR_COLORS } from './TrackOutline';
import FlagName from './FlagName';
import { DriverRow, FlagCounts, launchHref, roundLabel } from './raceBits';
import { fmtLapTime, stackedName } from './calendarFacts';

// the three.js inspector is its own chunk: nothing WebGL loads until a circuit is picked
const CircuitInspector = lazy(() => import('./CircuitInspector'));

function useBundle(slug: string) {
  const [bundle, setBundle] = useState<RaceBundle | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadRace(slug)
      .then((b) => alive && setBundle(b))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [slug]);
  return { bundle: bundle && bundle.summary.slug === slug ? bundle : null, failed };
}

function Facts({ race, bundle }: { race: RaceSummary; bundle: RaceBundle | null }) {
  const { code, color, driver } = useDriverLookup();
  const fl = race.fastestLap;
  const rows: [string, string][] = [
    ['Round', roundLabel(race)],
    ['Date', fmtDate(race.date)],
    ['Laps', race.totalLaps != null ? String(race.totalLaps) : '—'],
    ['Lap length', bundle ? `${bundle.circuit.lengthKm.toFixed(3)} km` : '…'],
    ['Elevation Δ', bundle ? `${bundle.circuit.elevationRangeM.toFixed(1)} m` : '…'],
    ['Overtakes', String(race.overtakeCount)],
    ['DNFs', String(race.dnfCount)],
  ];
  return (
    <div className="flex flex-col gap-4 text-ink">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border-2 border-ink bg-white px-3 py-3 font-mono text-[11px] shadow-sticker-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-ink/70">{k}</dt>
            <dd className="font-semibold tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1.5">
        <DriverRow label="Favourites" numbers={race.qualifyingTop3} />
        <DriverRow label="Podium" numbers={race.podium} />
      </div>
      <FlagCounts race={race} />
      {fl && (
        <div className="font-mono text-[11px] text-ink/70">
          Fastest lap <span className="font-semibold text-ink">{fmtLapTime(fl.time)}</span> ·{' '}
          <DriverChip code={code(fl.driverNumber)} color={color(fl.driverNumber)} title={driver(fl.driverNumber)?.fullName} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/70">
        {['S1', 'S2', 'S3'].map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span className="h-[6px] w-5 rounded-[2px] ring-1 ring-ink" style={{ background: SECTOR_COLORS[i] }} />
            {s}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-[6px] w-5 rounded-[2px] bg-[repeating-linear-gradient(90deg,#FF1E1E_0_3px,#F2F2F2_3px_6px)] ring-1 ring-ink" />
          Apex kerb
        </span>
      </div>
      <p className="font-mono text-[9px] leading-relaxed text-ink/70">
        Layout: OpenF1 location telemetry · Track widths:{' '}
        <a className="underline decoration-ink/40 hover:text-ink" href="https://github.com/TUMFTM/racetrack-database" target="_blank" rel="noreferrer">
          TUMFTM racetrack-database
        </a>{' '}
        (LGPL-3.0, from OpenStreetMap) · Layout approach inspired by{' '}
        <a className="underline decoration-ink/40 hover:text-ink" href="https://github.com/makakashan/F1TrackViewer" target="_blank" rel="noreferrer">
          Boxlane/F1TrackViewer
        </a>{' '}
        (MIT) · Surroundings are procedural, not mapped.
      </p>
    </div>
  );
}

/**
 * Full-screen 3D circuit inspector. Mounted only while a circuit is picked: the race bundle
 * and the WebGL <Canvas> are created on open and disposed when it closes (unmount), so the
 * page never holds more than one WebGL context.
 */
export default function InspectorOverlay({ race, onClose }: { race: RaceSummary; onClose: () => void }) {
  const { bundle, failed } = useBundle(race.slug);
  const circuit = bundle?.circuit ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `inspector-title-${race.slug}`;

  // focus the close button, restore focus to the trigger on close, lock page scroll, Esc closes
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && dialogRef.current) {
        // minimal focus trap
        const f = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="theme-paper fixed inset-0 z-[60] flex items-stretch justify-center bg-ink/75 p-0 sm:p-4 lg:p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-[1600px] flex-col overflow-y-auto overscroll-contain border-ink bg-cream shadow-sticker-lg sm:rounded-[22px] sm:border-[3px] lg:grid lg:grid-cols-[1fr_400px] lg:overflow-hidden"
      >
        <div className="relative h-[52svh] min-h-[300px] shrink-0 bg-[#BFE6FF] lg:h-full">
          {circuit && (
            <Suspense fallback={<Loader label="Laying tarmac…" />}>
              <CircuitInspector circuit={circuit} />
            </Suspense>
          )}
          {!circuit && (
            <div className="absolute inset-0 flex items-center justify-center">
              {failed ? (
                <div className="rounded-md border-2 border-ink bg-cream px-3 py-2 font-mono text-xs text-ink shadow-sticker-sm">No circuit data for this round</div>
              ) : (
                <Loader label="Loading circuit…" />
              )}
            </div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 -rotate-1 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-sticker-sm">
            3D inspector<span className="hidden sm:inline"> · drag to orbit · scroll to zoom</span>
          </div>
        </div>
        <div className="pop-dots flex flex-col gap-4 border-t-[3px] border-ink bg-cream p-4 pb-6 lg:overflow-y-auto lg:border-l-[3px] lg:border-t-0">
          <div className="pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={race.status} />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink/70">
                {roundLabel(race)} · {race.country}
              </span>
            </div>
            <FlagName as="h2" id={titleId} country={race.country} text={stackedName(race.name)} className="mt-3 text-[clamp(44px,4.6vw,58px)]" />
            <div className="mt-1 font-mono text-[11px] text-ink/70">{race.circuitName}</div>
          </div>
          <Facts race={race} bundle={bundle} />
          <Link
            to={launchHref(race.slug)}
            className="mt-auto flex items-center justify-center gap-2 rounded-full border-[2.5px] border-ink bg-pop-pink px-4 py-2.5 font-display text-xl uppercase tracking-wide text-ink shadow-sticker transition-transform hover:-translate-y-0.5 active:translate-y-px"
          >
            <Play size={16} fill="currentColor" /> Launch race
          </Link>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="fixed right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border-[2.5px] border-ink bg-pop-sun text-ink shadow-sticker-sm transition-transform hover:-translate-y-px active:translate-y-px sm:absolute"
        >
          <X size={20} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}
