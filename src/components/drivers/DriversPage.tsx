import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeasonData } from '@/types';
import { useSeason } from '@/store/seasonStore';
import Loader from '@/components/ui/Loader';
import { useMediaQuery } from '@/components/ui/hooks';
import { CurvedSheet, PageTitle } from '@/components/ui/primitives';
import { buildRoster, type RosterEntry } from './roster';
import { loadManifest, mediaFor, type MediaManifest } from './driverMedia';
import { RevealContext, useRevealEngineHost } from './revealContext';
import { RevealFrame } from './DriverCard';
import { driverHref } from './driverLinks';

const CREDITS = 'Driver portraits © Formula 1. Helmet images © the respective teams, drivers, helmet makers and photographers (sources: official team and driver stores, F1 Authentics, helmetarchive.com; see SOURCES.md). Unofficial fan project, not affiliated with Formula 1.';

function DriverInfo({ entry, compact = false }: { entry: RosterEntry; compact?: boolean }) {
  const { driver, team, standing } = entry;
  return (
    <div className={`mt-2.5 flex items-start justify-between gap-2 ${compact ? '' : 'px-0.5'}`}>
      <div className="min-w-0">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/70">
          {driver.code} · #{driver.number}
        </div>
        <div className="truncate font-display text-[22px] uppercase leading-[1.02] tracking-wide text-ink">
          <span className="block truncate text-[13px] tracking-[0.06em] text-ink/80">{driver.firstName}</span>
          {driver.lastName}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] text-ink/70">
          <span className="h-2 w-2 shrink-0 rounded-full border border-ink" style={{ background: team.color }} />
          {team.name}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="inline-block -rotate-2 rounded-[4px] border-[1.5px] border-ink bg-pop-sun px-1.5 font-mono text-[11px] font-bold text-ink shadow-sticker-sm">
          {standing ? `P${standing.position}` : '—'}
        </div>
        <div className="mt-1 font-mono text-[11px] font-bold tabular-nums text-ink-green">{standing ? `${standing.points} pts` : 'no data'}</div>
      </div>
    </div>
  );
}

function DriversContent({ season }: { season: SeasonData }) {
  const roster = useMemo(() => buildRoster(season), [season]);
  const [manifest, setManifest] = useState<MediaManifest>({ drivers: {} });
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const engine = useRevealEngineHost(!reducedMotion);

  useEffect(() => {
    let alive = true;
    void loadManifest().then((m) => alive && setManifest(m));
    return () => {
      alive = false;
    };
  }, []);

  const leader = roster.drivers[0];
  const teamPos = new Map(season.constructorStandings.map((c) => [c.teamId, c]));
  const missing = roster.drivers.filter((d) => !mediaFor(manifest, d.driver.code).helmet).length;
  const noPortrait = roster.drivers.filter((d) => !mediaFor(manifest, d.driver.code).portrait).length;
  const lastRound = [...season.races].reverse().find((r) => r.status === 'completed');

  return (
    <RevealContext.Provider value={engine}>
      <div className="theme-paper min-h-screen overflow-x-clip bg-cream pt-12">
        {/* hero sheet */}
        <section className="pop-dots relative bg-pop-blue">
          <div className="pop-halftone pop-halftone-light" />
          <div className="relative mx-auto grid max-w-[1400px] items-end gap-8 px-4 pb-24 pt-10 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:pb-28">
            <div className="min-w-0">
              <PageTitle kicker={`2026 grid · ${roster.drivers.length} race drivers`}>Drivers</PageTitle>
              <p className="mt-5 max-w-md font-mono text-[13px] leading-relaxed text-cream/90">
                Every race seat of the 2026 season, in championship order. Run your cursor over a driver's face and their 2026 helmet floods in under it; tap on a phone, or tab through
                with the keyboard.
              </p>
              {leader && (
                <div className="mt-6 inline-flex rotate-1 items-center gap-3 rounded-lg border-2 border-ink bg-pop-sun px-3 py-2 shadow-sticker">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/80">Championship leader</span>
                  <span className="font-display text-2xl uppercase leading-none text-ink">{leader.driver.lastName}</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-ink">{leader.standing?.points ?? '—'} pts</span>
                </div>
              )}
              {missing > 0 && (
                <p className="mt-5 max-w-md rounded-md border-2 border-dashed border-cream/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-cream/90">
                  {noPortrait === roster.drivers.length
                    ? 'Driver photos are not bundled with this build: the cards show labelled stand-ins.'
                    : `${missing} of ${roster.drivers.length} 2026 helmet designs are not available as clean images yet: those reveals show a "coming soon" panel.`}
                </p>
              )}
            </div>
            {leader && (
              <div className="mx-auto w-full max-w-[420px] lg:mr-0">
                <RevealFrame
                  entry={leader}
                  media={mediaFor(manifest, leader.driver.code)}
                  variant="hero"
                  reducedMotion={reducedMotion}
                  eager
                  href={driverHref(leader.driver.code)}
                />
                <div className="rounded-b-xl text-cream">
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-cream/80">
                        P{leader.standing?.position} · #{leader.driver.number} · {leader.team.name}
                      </div>
                      <div className="truncate font-display text-4xl uppercase leading-none tracking-wide [text-shadow:0.05em_0.06em_0_#170F33]">{leader.driver.fullName}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* championship-order grid */}
        <CurvedSheet bg="bg-cream" depth={56} className="-mt-12">
          <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-2 sm:px-6">
            <header className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-1.5">
              <h2 className="font-display text-3xl uppercase leading-none tracking-wide text-ink">Championship order</h2>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/70">
                after R{lastRound?.round ?? '—'} {lastRound?.circuitName ?? ''}
              </span>
            </header>
            <ol className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-6">
              {roster.drivers.map((d) => {
                const c = teamPos.get(d.team.id);
                return (
                  <li key={d.driver.number} className="min-w-0">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="font-display text-2xl leading-none text-ink">P{d.standing?.position ?? '—'}</span>
                      <span className="h-1.5 flex-1 -skew-x-12 border-[1.5px] border-ink" style={{ background: d.team.color }} title={c ? `${d.team.name}: P${c.position} in the constructors'` : d.team.name} />
                    </div>
                    <RevealFrame
                      entry={d}
                      media={mediaFor(manifest, d.driver.code)}
                      variant="card"
                      reducedMotion={reducedMotion}
                      href={driverHref(d.driver.code)}
                      sizes="(min-width: 1280px) 15vw, (min-width: 1024px) 23vw, (min-width: 640px) 30vw, 46vw"
                    />
                    <DriverInfo entry={d} />
                    <Link
                      to={driverHref(d.driver.code)}
                      className="mt-2 inline-block rounded-md border-2 border-ink bg-white px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink shadow-sticker-sm hover:-translate-y-px"
                    >
                      Season stats
                    </Link>
                  </li>
                );
              })}
            </ol>

            {roster.reserves.length > 0 && (
              <p className="mt-12 font-mono text-[11px] leading-relaxed text-ink/70">
                Also entered in the 2026 data (reserves / one-off substitutes, not shown above):{' '}
                {roster.reserves.map((r, i) => (
                  <span key={r.driver.number}>
                    {i > 0 && ', '}
                    {r.driver.fullName} ({r.team.name}, {r.results} classified {r.results === 1 ? 'result' : 'results'})
                  </span>
                ))}
                .
              </p>
            )}
            <p className="mt-4 border-t-2 border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-ink/60">{CREDITS}</p>
          </div>
        </CurvedSheet>
      </div>
    </RevealContext.Provider>
  );
}

export default function DriversPage() {
  const season = useSeason();
  useEffect(() => {
    document.title = 'Drivers · GhostLap 2026';
  }, []);
  if (!season) return <Loader />;
  return <DriversContent season={season} />;
}
