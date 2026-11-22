import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Play, Box } from 'lucide-react';
import type { RaceBundle, RaceSummary, SeasonData } from '@/types';
import { useDriverLookup, useSeason } from '@/store/seasonStore';
import { loadRace } from '@/engine/dataLoader';
import Loader from '@/components/ui/Loader';
import { CurvedSheet, DriverChip, PageTitle, Segmented, SectionHeading, StatusBadge, fmtDate } from '@/components/ui/primitives';
import { OfficialOutline, SECTOR_COLORS } from './TrackOutline';

const CircuitInspector = lazy(() => import('./CircuitInspector'));

type Filter = 'all' | 'completed' | 'upcoming';

const roundLabel = (r: RaceSummary) => (r.round > 0 ? `R${String(r.round).padStart(2, '0')}` : '—');
const launchHref = (slug: string) => `/replay/${slug}?autoplay=1`;

/** Sticker colours the completed rounds' map panels cycle through (by calendar index). */
const CARD_SHEETS = ['bg-paper-orange', 'bg-paper-yellow', 'bg-paper-sky', 'bg-neon', 'bg-paper-lilac'];
const sheetFor = (race: RaceSummary, index: number) =>
  race.status === 'cancelled'
    ? 'bg-[repeating-linear-gradient(45deg,#E8E0CA_0_10px,#DCD2B6_10px_20px)]'
    : race.status === 'upcoming'
      ? 'bg-cream-dark'
      : CARD_SHEETS[index % CARD_SHEETS.length];

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
      <span className="w-16 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/70">{label}</span>
      <div className="flex flex-wrap gap-1">
        {numbers.length ? (
          numbers.map((n, i) => (
            <span key={n} className="flex items-center gap-0.5">
              <span className="font-mono text-[9px] text-ink/70">P{i + 1}</span>
              <DriverChip code={code(n)} color={color(n)} title={driver(n)?.fullName} />
            </span>
          ))
        ) : (
          <span className="font-mono text-[11px] text-ink/70">—</span>
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
        <span
          key={i.k}
          className={`inline-flex items-center overflow-hidden rounded-[4px] border-[1.5px] ${i.v ? 'border-ink bg-white font-semibold text-ink' : 'border-ink/25 text-ink/70'}`}
        >
          <span className={`px-1 py-0.5 ${i.v ? 'border-r-[1.5px] border-ink' : ''}`} style={{ background: i.v ? i.c : undefined }}>
            {i.k}
          </span>
          <span className="px-1 py-0.5">×{i.v}</span>
        </span>
      ))}
      {race.winnerGapSeconds != null && (
        <span className="rounded-[4px] border-[1.5px] border-ink bg-white px-1.5 py-0.5 text-ink">
          Margin <span className="font-bold text-ink-green">+{race.winnerGapSeconds.toFixed(3)}s</span>
        </span>
      )}
    </div>
  );
}

function CardOutline({ race, index }: { race: RaceSummary; index: number }) {
  return (
    <div className={`paper-tex relative flex h-32 items-center justify-center overflow-hidden border-b-[2.5px] border-ink ${sheetFor(race, index)}`}>
      <span className="absolute left-2.5 top-1.5 font-display text-[26px] leading-none text-ink">{roundLabel(race)}</span>
      {race.outline ? (
        <OfficialOutline
          outline={race.outline}
          color="#0F1A12"
          halo="rgba(255,255,255,0.65)"
          strokeWidth={3.4}
          className={`h-[86%] w-[86%] ${race.status === 'completed' ? '' : 'opacity-70'}`}
        />
      ) : (
        <span className="px-6 text-center font-mono text-[10px] font-semibold uppercase tracking-widest text-ink/70">
          {race.status === 'cancelled' ? 'Event cancelled' : 'Track map after race weekend'}
        </span>
      )}
      {race.status === 'cancelled' && (
        <span className="absolute bottom-1.5 right-2 -rotate-2 rounded-[3px] bg-ink px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-cream">
          Cancelled · no session data
        </span>
      )}
    </div>
  );
}

function CircuitCard({ race, index, selected, onSelect }: { race: RaceSummary; index: number; selected: boolean; onSelect: () => void }) {
  const done = race.status === 'completed';
  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border-[2.5px] border-ink bg-cream text-ink transition-transform duration-200 hover:-translate-y-1 ${
        selected ? 'shadow-sticker-lg ring-4 ring-neon ring-offset-2 ring-offset-paper-green' : 'shadow-sticker'
      }`}
    >
      <CardOutline race={race} index={index} />
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] text-ink/70">
              <span className="font-semibold text-ink">{fmtDate(race.date)}</span>
              <span className="truncate">{race.country}</span>
            </div>
            <h3
              className={`mt-0.5 truncate font-display text-[22px] uppercase leading-tight tracking-wide ${
                race.status === 'cancelled' ? 'line-through decoration-[#D7102A] decoration-2' : ''
              }`}
            >
              {race.name.replace(' Grand Prix', ' GP')}
            </h3>
            <div className="truncate font-mono text-[10px] text-ink/70">{race.circuitName}</div>
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
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-ink px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink shadow-sticker-sm transition-transform active:translate-y-px ${
                  selected ? 'bg-ghost' : 'bg-white hover:-translate-y-px'
                }`}
              >
                <Box size={12} /> {selected ? 'In inspector' : 'Inspect 3D'}
              </button>
              <Link
                to={launchHref(race.slug)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-ink bg-neon px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink shadow-sticker-sm transition-transform hover:-translate-y-px active:translate-y-px"
              >
                <Play size={12} fill="currentColor" /> Launch race
              </Link>
            </>
          ) : (
            <div className="flex-1 rounded-md border-2 border-dashed border-ink/40 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/70">
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
    <div className="flex h-full flex-col gap-4 p-4 text-ink">
      <div>
        <div className="flex items-center gap-2">
          <StatusBadge status={race.status} />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink/70">{race.country}</span>
        </div>
        <h2 className="mt-2 font-display text-4xl uppercase leading-[0.92] tracking-wide text-paper-green">{race.name}</h2>
        <div className="mt-1 font-mono text-[11px] text-ink/70">{race.circuitName}</div>
      </div>
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
          Fastest lap <span className="font-semibold text-ink">{fmtLap(fl.time)}</span> ·{' '}
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
      <Link
        to={launchHref(race.slug)}
        className="mt-auto flex items-center justify-center gap-2 rounded-full border-[2.5px] border-ink bg-neon px-4 py-2.5 font-display text-xl uppercase tracking-wide text-ink shadow-sticker transition-transform hover:-translate-y-0.5 active:translate-y-px"
      >
        <Play size={16} fill="currentColor" /> Launch race
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
    <main className="theme-paper min-h-screen overflow-x-clip bg-paper-green">
      {/* ---------------- lime header sheet: title + 3D inspector ---------------- */}
      <section className="paper-tex bg-neon pb-24 pt-16 sm:pb-28">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <PageTitle kicker={`Calendar · ${season.races.length} events`}>
              Circuit <br className="sm:hidden" />
              Directory
            </PageTitle>
            <div className="flex flex-wrap gap-2 pb-2 font-mono text-[11px] font-semibold uppercase tracking-wider">
              <span className="rotate-[-3deg] rounded-md border-2 border-ink bg-paper-green px-2 py-1 text-neon shadow-sticker-sm">
                <span className="font-display text-base">{counts.completed}</span> completed
              </span>
              <span className="rotate-[2deg] rounded-md border-2 border-ink bg-[#D7102A] px-2 py-1 text-white shadow-sticker-sm">
                <span className="font-display text-base">{counts.cancelled}</span> cancelled
              </span>
              <span className="rotate-[-1deg] rounded-md border-2 border-ink bg-paper-lilac px-2 py-1 text-ink shadow-sticker-sm">
                <span className="font-display text-base">{counts.upcoming}</span> upcoming
              </span>
            </div>
          </header>

          {selected && (
            <section
              ref={inspectorRef}
              className="scroll-mt-16 overflow-hidden rounded-[22px] border-[3px] border-ink bg-cream shadow-sticker-lg lg:grid lg:grid-cols-[1fr_380px]"
            >
              <div className="relative h-[46vh] min-h-[320px] bg-[#CFE7F5] lg:h-[560px]">
                <Suspense fallback={<Loader label="Laying tarmac…" />}>
                  <CircuitInspector circuit={circuit} />
                </Suspense>
                {!circuit && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <Loader label="Loading circuit…" />
                  </div>
                )}
                <div className="pointer-events-none absolute left-3 top-3 -rotate-1 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-sticker-sm">
                  3D inspector<span className="hidden sm:inline"> · drag to orbit · scroll to zoom</span>
                </div>
              </div>
              <div className="paper-tex border-t-[3px] border-ink bg-cream lg:border-l-[3px] lg:border-t-0">
                <InspectorPanel race={selected} bundle={bundle} />
              </div>
            </section>
          )}
          {selected && (
            <p className="mt-4 font-mono text-[10px] leading-relaxed text-ink/75">
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
          )}
        </div>
      </section>

      {/* ---------------- racing-green calendar sheet (curved split) ---------------- */}
      <CurvedSheet bg="bg-paper-green" depth={72} className="pb-20">
        <div className="mx-auto max-w-[1600px] px-4 pt-2 sm:px-6">
          <SectionHeading kicker="All rounds" title="2026 Calendar" tone="lime">
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map((r) => (
              <CircuitCard key={r.slug} race={r} index={season.races.indexOf(r)} selected={r.slug === selectedSlug} onSelect={() => select(r.slug)} />
            ))}
          </div>
        </div>
      </CurvedSheet>
    </main>
  );
}

export default function CircuitsPage() {
  const season = useSeason();
  if (!season)
    return (
      <main className="theme-paper paper-tex min-h-screen bg-neon pt-12">
        <Loader label="Loading calendar…" />
      </main>
    );
  return <Directory season={season} />;
}
