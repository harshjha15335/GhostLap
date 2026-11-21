import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Play, Box } from 'lucide-react';
import type { RaceBundle, RaceSummary, SeasonData } from '@/types';
import { useDriverLookup, useSeason } from '@/store/seasonStore';
import { loadRace } from '@/engine/dataLoader';
import Loader from '@/components/ui/Loader';
import { useInView } from '@/components/ui/hooks';
import { DriverChip, Segmented, SectionHeading, StatusBadge, fmtDate } from '@/components/ui/primitives';
import TrackOutline, { SECTOR_COLORS } from './TrackOutline';

const CircuitInspector = lazy(() => import('./CircuitInspector'));

type Filter = 'all' | 'completed' | 'upcoming';

const roundLabel = (r: RaceSummary) => (r.round > 0 ? `R${String(r.round).padStart(2, '0')}` : '—');
const launchHref = (slug: string) => `/replay/${slug}?autoplay=1`;

function useBundle(slug: string | null, enabled = true) {
  const [bundle, setBundle] = useState<RaceBundle | null>(null);
  useEffect(() => {
    if (!slug || !enabled) return;
    let alive = true;
    loadRace(slug)
      .then((b) => alive && setBundle(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug, enabled]);
  // only return the bundle for the slug that was asked for (avoids a stale circuit flashing)
  return bundle && slug && bundle.summary.slug === slug ? bundle : null;
}

function DriverRow({ label, numbers }: { label: string; numbers: number[] }) {
  const { code, color, driver } = useDriverLookup();
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <div className="flex flex-wrap gap-1">
        {numbers.length ? (
          numbers.map((n, i) => (
            <span key={n} className="flex items-center gap-0.5">
              <span className="font-mono text-[9px] text-white/35">P{i + 1}</span>
              <DriverChip code={code(n)} color={color(n)} title={driver(n)?.fullName} />
            </span>
          ))
        ) : (
          <span className="font-mono text-[11px] text-white/30">—</span>
        )}
      </div>
    </div>
  );
}

function FlagCounts({ race }: { race: RaceSummary }) {
  const items = [
    { k: 'SC', v: race.safetyCars, c: '#FF7A00' },
    { k: 'VSC', v: race.virtualSafetyCars, c: '#FFD400' },
    { k: 'RED', v: race.redFlags, c: '#FF1E1E' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
      {items.map((i) => (
        <span key={i.k} className={`rounded-sm border px-1.5 py-0.5 ${i.v ? 'border-white/15 text-white/85' : 'border-line text-white/30'}`}>
          <span style={{ color: i.v ? i.c : undefined }}>{i.k}</span> ×{i.v}
        </span>
      ))}
      {race.winnerGapSeconds != null && (
        <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-white/85">
          Margin <span className="text-neon">+{race.winnerGapSeconds.toFixed(3)}s</span>
        </span>
      )}
    </div>
  );
}

function CardOutline({ race }: { race: RaceSummary }) {
  const [ref, inView] = useInView<HTMLDivElement>('300px');
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (inView) setSeen(true);
  }, [inView]);
  const bundle = useBundle(race.hasBundle ? race.slug : null, seen);
  return (
    <div ref={ref} className="relative flex h-32 items-center justify-center overflow-hidden border-b border-line bg-[radial-gradient(circle_at_50%_60%,#141a24,transparent_70%)]">
      {bundle ? (
        <TrackOutline circuit={bundle.circuit} className="h-[84%] w-[84%]" />
      ) : race.hasBundle ? (
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/25 animate-pulse">Loading telemetry…</span>
      ) : (
        <span className="px-6 text-center font-mono text-[10px] uppercase tracking-widest text-white/25">
          {race.status === 'cancelled' ? 'Event cancelled · no session data' : 'Track map after race weekend'}
        </span>
      )}
      {bundle && (
        <span className="absolute bottom-1.5 right-2 font-mono text-[9px] text-white/35">{bundle.circuit.lengthKm.toFixed(3)} km</span>
      )}
    </div>
  );
}

function CircuitCard({ race, selected, onSelect }: { race: RaceSummary; selected: boolean; onSelect: () => void }) {
  const done = race.status === 'completed';
  return (
    <article
      className={`group flex flex-col overflow-hidden rounded border bg-panel transition-colors ${
        selected ? 'border-neon/70 shadow-[0_0_0_1px_#D4FF0033,0_12px_40px_-12px_#D4FF0044]' : 'border-line hover:border-white/25'
      } ${race.status === 'cancelled' ? 'opacity-70' : ''}`}
    >
      <CardOutline race={race} />
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] text-white/45">
              <span className="text-white/80">{roundLabel(race)}</span>
              <span>{fmtDate(race.date)}</span>
              <span className="truncate">{race.country}</span>
            </div>
            <h3 className={`mt-0.5 truncate font-display text-lg uppercase leading-tight tracking-wide ${race.status === 'cancelled' ? 'line-through decoration-crimson/70' : ''}`}>
              {race.name.replace(' Grand Prix', ' GP')}
            </h3>
            <div className="truncate font-mono text-[10px] text-white/40">{race.circuitName}</div>
          </div>
          <StatusBadge status={race.status} />
        </div>
        {done && (
          <>
            <div className="space-y-1">
              <DriverRow label="Favourites" numbers={race.qualifyingTop3} />
              <DriverRow label="Podium" numbers={race.podium} />
            </div>
            <FlagCounts race={race} />
          </>
        )}
        <div className="mt-auto flex gap-2 pt-1">
          {done && race.hasBundle ? (
            <>
              <button
                type="button"
                onClick={onSelect}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
                  selected ? 'border-ghost/60 text-ghost' : 'border-line text-white/70 hover:border-white/30 hover:text-white'
                }`}
              >
                <Box size={12} /> {selected ? 'In inspector' : 'Inspect 3D'}
              </button>
              <Link
                to={launchHref(race.slug)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-neon px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-asphalt hover:brightness-110"
              >
                <Play size={12} fill="currentColor" /> Launch race
              </Link>
            </>
          ) : (
            <div className="flex-1 rounded-sm border border-dashed border-line px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
              {race.status === 'cancelled' ? 'Not held' : 'Race Lab unlocks after the race'}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function InspectorPanel({ race, bundle }: { race: RaceSummary; bundle: RaceBundle | null }) {
  const { code, color, driver } = useDriverLookup();
  const fl = race.fastestLap;
  const fmtLap = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
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
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <div className="flex items-center gap-2">
          <StatusBadge status={race.status} />
          <span className="font-mono text-[10px] text-white/40">{race.country}</span>
        </div>
        <h2 className="mt-1 font-display text-3xl uppercase leading-none tracking-wide">{race.name}</h2>
        <div className="mt-1 font-mono text-[11px] text-white/50">{race.circuitName}</div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-y border-line py-3 font-mono text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-white/40">{k}</dt>
            <dd className="tabular-nums text-white/90">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1.5">
        <DriverRow label="Favourites" numbers={race.qualifyingTop3} />
        <DriverRow label="Podium" numbers={race.podium} />
      </div>
      <FlagCounts race={race} />
      {fl && (
        <div className="font-mono text-[11px] text-white/60">
          Fastest lap <span className="text-white/90">{fmtLap(fl.time)}</span> ·{' '}
          <DriverChip code={code(fl.driverNumber)} color={color(fl.driverNumber)} title={driver(fl.driverNumber)?.fullName} />
        </div>
      )}
      <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">
        {['S1', 'S2', 'S3'].map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span className="h-[3px] w-4" style={{ background: SECTOR_COLORS[i] }} />
            {s}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-[3px] w-4 bg-[repeating-linear-gradient(90deg,#FF1E1E_0_3px,#F2F2F2_3px_6px)]" />
          Apex kerb
        </span>
      </div>
      <Link
        to={launchHref(race.slug)}
        className="mt-auto flex items-center justify-center gap-2 rounded-sm bg-neon px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-asphalt hover:brightness-110"
      >
        <Play size={14} fill="currentColor" /> Launch race
      </Link>
    </div>
  );
}

function Directory({ season }: { season: SeasonData }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const inspectorRef = useRef<HTMLDivElement>(null);
  const completed = season.races.filter((r) => r.status === 'completed' && r.hasBundle);
  const fallback = completed[completed.length - 1]?.slug ?? null;
  const selectedSlug = completed.some((r) => r.slug === params.get('c')) ? params.get('c') : fallback;
  const selected = season.races.find((r) => r.slug === selectedSlug) ?? null;
  const bundle = useBundle(selectedSlug);
  const circuit = bundle?.circuit ?? null;

  const counts = useMemo(
    () => ({
      completed: season.races.filter((r) => r.status === 'completed').length,
      cancelled: season.races.filter((r) => r.status === 'cancelled').length,
      upcoming: season.races.filter((r) => r.status === 'upcoming').length,
    }),
    [season],
  );
  const shown = season.races.filter((r) => filter === 'all' || r.status === filter);

  const select = (slug: string) => {
    setParams({ c: slug }, { replace: true });
    inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-20 pt-16 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-neon/80">Calendar · {season.races.length} events</div>
          <h1 className="font-display text-5xl uppercase leading-none tracking-wide sm:text-6xl">
            Circuit <span className="text-neon">Directory</span>
          </h1>
        </div>
        <div className="flex gap-4 font-mono text-[11px] text-white/55">
          <span><span className="text-neon">{counts.completed}</span> completed</span>
          <span><span className="text-crimson">{counts.cancelled}</span> cancelled</span>
          <span><span className="text-ghost">{counts.upcoming}</span> upcoming</span>
        </div>
      </header>

      {selected && (
        <section ref={inspectorRef} className="mb-10 scroll-mt-16 overflow-hidden rounded border border-line bg-panel lg:grid lg:grid-cols-[1fr_380px]">
          <div className="relative h-[46vh] min-h-[320px] lg:h-[560px]">
            <Suspense fallback={<Loader label="Laying tarmac…" />}>
              <CircuitInspector circuit={circuit} />
            </Suspense>
            {!circuit && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader label="Loading circuit…" /></div>}
            <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">
              3D inspector<span className="hidden sm:inline"> · drag to orbit · scroll to zoom</span>
            </div>
          </div>
          <div className="border-t border-line lg:border-l lg:border-t-0">
            <InspectorPanel race={selected} bundle={bundle} />
          </div>
        </section>
      )}

      <SectionHeading kicker="All rounds" title="2026 Calendar">
        <Segmented<Filter>
          label="Filter races"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${season.races.length}` },
            { value: 'completed', label: `Completed ${counts.completed}` },
            { value: 'upcoming', label: `Upcoming ${counts.upcoming}` },
          ]}
        />
      </SectionHeading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((r) => (
          <CircuitCard key={r.slug} race={r} selected={r.slug === selectedSlug} onSelect={() => select(r.slug)} />
        ))}
      </div>
    </main>
  );
}

export default function CircuitsPage() {
  const season = useSeason();
  if (!season) return <main className="pt-12"><Loader label="Loading calendar…" /></main>;
  return <Directory season={season} />;
}
