import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Play, Box } from 'lucide-react';
import type { RaceSummary, SeasonData } from '@/types';
import Loader from '@/components/ui/Loader';
import { CurvedSheet, Segmented, SectionHeading, StatusBadge, fmtDate } from '@/components/ui/primitives';
import { OfficialOutline } from './TrackOutline';
import { useSeason } from '@/store/seasonStore';
import FlagName from './FlagName';
import CalendarHero from './CalendarHero';
import { DriverRow, FlagCounts, canInspect, launchHref, roundLabel } from './raceBits';
import { stackedName } from './calendarFacts';

// the overlay (and, inside it, the three.js inspector) only loads when a circuit is picked
const InspectorOverlay = lazy(() => import('./InspectorOverlay'));

type Filter = 'all' | 'completed' | 'upcoming';

/** Sticker colours the completed rounds' map panels cycle through (by calendar index). */
const CARD_SHEETS = ['bg-pop-pink', 'bg-pop-sky', 'bg-pop-papaya', 'bg-cream-dark'];
const sheetFor = (race: RaceSummary, index: number) =>
  race.status === 'cancelled'
    ? 'bg-[repeating-linear-gradient(45deg,#F2E6D9_0_10px,#E3D3C2_10px_20px)]'
    : race.status === 'upcoming'
      ? 'bg-[#E9E4F5]'
      : CARD_SHEETS[index % CARD_SHEETS.length];

const cardId = (slug: string) => `circuit-${slug}`;

function CardOutline({ race, index }: { race: RaceSummary; index: number }) {
  return (
    <div className={`pop-dots relative flex h-32 items-center justify-center overflow-hidden border-b-[2.5px] border-ink ${sheetFor(race, index)}`}>
      {race.round > 0 && <span className="absolute left-2.5 top-1.5 font-display text-[26px] leading-none text-ink">{roundLabel(race)}</span>}
      {race.outline ? (
        <OfficialOutline
          outline={race.outline}
          color="#170F33"
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

function CircuitCard({ race, index, flash, onInspect }: { race: RaceSummary; index: number; flash: boolean; onInspect: () => void }) {
  const done = race.status === 'completed';
  return (
    <article
      id={cardId(race.slug)}
      aria-label={`${race.name} — ${race.circuitName}`}
      className={`group flex scroll-mt-20 flex-col overflow-hidden rounded-2xl border-[2.5px] border-ink bg-cream text-ink transition-[transform,box-shadow] duration-200 hover:-translate-y-1 ${
        flash ? 'shadow-sticker-lg ring-4 ring-pop-pink ring-offset-2 ring-offset-pop-sun' : 'shadow-sticker'
      }`}
    >
      <CardOutline race={race} index={index} />
      <div className="pop-dots flex flex-1 flex-col gap-2.5 p-3 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] text-ink/70">
            <span className="font-semibold text-ink">{fmtDate(race.date)}</span>
            <span className="truncate">{race.country}</span>
          </div>
          <StatusBadge status={race.status} />
        </div>
        <div className="min-w-0">
          <FlagName as="h3" country={race.country} text={stackedName(race.name)} className="text-[clamp(38px,11vw,46px)] sm:text-[42px] 2xl:text-[44px]" />
          <div className="mt-1 truncate font-mono text-[10px] text-ink/70">{race.circuitName}</div>
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
          {canInspect(race) ? (
            <>
              <button
                type="button"
                onClick={onInspect}
                aria-haspopup="dialog"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-ink bg-white px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink shadow-sticker-sm transition-transform hover:-translate-y-px active:translate-y-px"
              >
                <Box size={12} /> Inspect 3D
              </button>
              <Link
                to={launchHref(race.slug)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-ink bg-pop-pink px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink shadow-sticker-sm transition-transform hover:-translate-y-px active:translate-y-px"
              >
                <Play size={12} fill="currentColor" /> Launch race
              </Link>
            </>
          ) : (
            <div className="flex-1 rounded-md border-2 border-dashed border-ink/40 px-2 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/70">
              {race.status === 'cancelled' ? 'Not held' : 'Race Lab unlocks after the race'}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function Directory({ season }: { season: SeasonData }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [flash, setFlash] = useState<string | null>(null);

  // ?race=slug deep-links the inspector open (legacy ?c=slug too); nothing loads otherwise
  const wanted = params.get('race') ?? params.get('c');
  const open = useMemo(() => season.races.find((r) => r.slug === wanted && canInspect(r)) ?? null, [season, wanted]);

  // opened from a card → a history entry, so Back (or the close button) pops it again
  const pushed = useRef(false);
  const inspect = useCallback(
    (slug: string) => {
      pushed.current = true;
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete('c');
        n.set('race', slug);
        return n;
      });
    },
    [setParams],
  );
  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('race');
        n.delete('c');
        return n;
      },
      { replace: true },
    );
  }, [setParams]);

  useEffect(() => {
    if (!open) pushed.current = false;
  }, [open]);

  const jump = useCallback((slug: string) => {
    setFilter('all');
    setFlash(slug);
    requestAnimationFrame(() => {
      const el = document.getElementById(cardId(slug));
      el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const counts = useMemo(
    () => ({
      completed: season.races.filter((r) => r.status === 'completed').length,
      upcoming: season.races.filter((r) => r.status === 'upcoming').length,
    }),
    [season],
  );
  const shown = season.races.filter((r) => filter === 'all' || r.status === filter);

  return (
    <main className="theme-paper min-h-screen overflow-x-clip bg-pop-sun">
      <CalendarHero races={season.races} onPick={jump} />

      <CurvedSheet bg="bg-pop-sun" depth={72} className="pb-20">
        <div className="mx-auto max-w-[1600px] px-4 pt-2 sm:px-6">
          <SectionHeading kicker={`All ${season.races.length} events`} title="Every circuit">
            <Segmented<Filter>
              label="Filter races"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${season.races.length}` },
                { value: 'completed', label: `Done ${counts.completed}` },
                { value: 'upcoming', label: `Next ${counts.upcoming}` },
              ]}
            />
          </SectionHeading>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map((r) => (
              <CircuitCard key={r.slug} race={r} index={season.races.indexOf(r)} flash={flash === r.slug} onInspect={() => inspect(r.slug)} />
            ))}
          </div>
          <p className="mt-8 font-mono text-[10px] text-ink/70">
            Flags:{' '}
            <a className="underline decoration-ink/40 hover:text-ink" href="https://github.com/lipis/flag-icons" target="_blank" rel="noreferrer">
              flag-icons
            </a>{' '}
            (MIT) · Calendar, results and laps: OpenF1.
          </p>
        </div>
      </CurvedSheet>

      {open && (
        <Suspense fallback={null}>
          <InspectorOverlay key={open.slug} race={open} onClose={close} />
        </Suspense>
      )}
    </main>
  );
}

export default function CircuitsPage() {
  const season = useSeason();
  if (!season)
    return (
      <main className="theme-paper pop-dots min-h-screen bg-pop-blue pt-12">
        <Loader label="Loading calendar…" />
      </main>
    );
  return <Directory season={season} />;
}
