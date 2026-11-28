import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { SeasonData, Team } from '@/types';
import type { CarPartId } from '@/components/three/F1Car';
import { useSeason } from '@/store/seasonStore';
import Loader from '@/components/ui/Loader';
import { useRaceBundles } from '@/components/ui/hooks';
import { CurvedSheet, SectionHeading } from '@/components/ui/primitives';
import {
  PART_LABEL,
  UPGRADE_AREA_PARTS,
  completedIndices,
  headToHead,
  ordinal,
  raceByRace,
  teamAchievements,
  teamPenaltySummary,
  teamSheet,
  teamShort,
  teamsByStanding,
  textOn,
  upgradeTitle,
  type HeadToHead,
  type RoundLine,
} from './teamStats';
import { STAGE_BG } from './ExplodedStage';
import PartsAllocationPanel from './PartsAllocationPanel';
import TeamBlueprint from './TeamBlueprint';
import { LineChart, UpgradeBadges, type Series } from './Charts';
import PenaltyLog from './PenaltyLog';

const ExplodedStage = lazy(() => import('./ExplodedStage'));

/* ------------------------------------------------------------------ */
/* Race-by-race table                                                  */
/* ------------------------------------------------------------------ */

function finishCell(c: RoundLine['cars'][number]) {
  if (c.status === 'DNF') return <span className="font-bold text-ink-red">DNF{c.dnfLap != null ? ` L${c.dnfLap}` : ''}</span>;
  if (c.status === 'DNS') return <span className="font-bold text-ink/70">DNS</span>;
  if (c.finish == null) return '—';
  return <span className={`font-bold ${c.finish <= 3 ? 'rounded-[3px] bg-pop-sun px-1 ring-1 ring-ink' : ''}`}>P{c.finish}</span>;
}

function RaceTable({ rounds, season, loading }: { rounds: RoundLine[]; season: SeasonData; loading: boolean }) {
  const byNumber = new Map(season.drivers.map((d) => [d.number, d]));
  const th = 'whitespace-nowrap border-b-2 border-ink px-2 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/75';
  const td = 'whitespace-nowrap px-2 py-1.5 align-top font-mono text-[11px] tabular-nums text-ink';
  return (
    <div className="overflow-hidden rounded-[20px] border-[3px] border-ink bg-cream-light shadow-sticker-lg">
      <div className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="Race-by-race results table, scrolls sideways">
        <table className="w-full min-w-[860px] border-collapse">
          <caption className="sr-only">Race-by-race results for both cars</caption>
          <thead className="bg-pop-sun">
            <tr>
              <th scope="col" className={th}>Round</th>
              <th scope="col" className={th}>Driver</th>
              <th scope="col" className={th}>Grid</th>
              <th scope="col" className={th}>Finish</th>
              <th scope="col" className={th}>+/−</th>
              <th scope="col" className={th}>GP pts</th>
              <th scope="col" className={th}>Stops</th>
              <th scope="col" className={th}>Avg lane</th>
              <th scope="col" className={th}>Notes</th>
              <th scope="col" className={th}>Team pts*</th>
              <th scope="col" className={th}>
                <span className="sr-only">Replay</span>
              </th>
            </tr>
          </thead>
          {rounds.map((r) => {
            const span = Math.max(1, r.cars.length);
            return (
              <tbody key={r.race.slug} className="border-b border-ink/20 odd:bg-white/70">
                {(r.cars.length ? r.cars : [null]).map((c, k) => {
                  const d = c ? byNumber.get(c.driverNumber) : undefined;
                  const gained = c && c.grid != null && c.finish != null ? c.grid - c.finish : null;
                  return (
                    <tr key={c?.driverNumber ?? 'none'}>
                      {k === 0 && (
                        <th scope="rowgroup" rowSpan={span} className={`${td} text-left font-normal`}>
                          <span className="font-bold">R{r.race.round}</span> <span className="text-ink/75">{r.race.circuitName}</span>
                        </th>
                      )}
                      {c ? (
                        <>
                          <td className={td}>
                            {d ? (
                              <Link to={`/drivers/${d.code}`} className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline">
                                <span className="h-3 w-[4px] ring-1 ring-ink" style={{ background: d.color }} />
                                {d.code}
                              </Link>
                            ) : (
                              `#${c.driverNumber}`
                            )}
                          </td>
                          <td className={td}>{c.grid == null ? (r.hasBundle ? 'pit' : '—') : `P${c.grid}`}</td>
                          <td className={td}>{finishCell(c)}</td>
                          <td className={`${td} ${gained == null ? '' : gained > 0 ? 'text-ink-green' : gained < 0 ? 'text-ink-red' : 'text-ink/60'}`}>
                            {gained == null ? '—' : gained > 0 ? `▲${gained}` : gained < 0 ? `▼${-gained}` : '='}
                          </td>
                          <td className={td}>{c.points == null ? '—' : c.points}</td>
                          <td className={td}>{c.pitStops == null ? '—' : c.pitStops}</td>
                          <td className={td}>{c.avgPitLane == null ? '—' : `${c.avgPitLane.toFixed(2)}s`}</td>
                          <td className={`${td} max-w-[260px] whitespace-normal text-[10px] text-ink/80`}>{c.reason ?? ''}</td>
                        </>
                      ) : (
                        <td colSpan={8} className={`${td} text-ink/70`}>
                          No classified result {loading ? '(loading race data…)' : ''}
                        </td>
                      )}
                      {k === 0 && (
                        <>
                          <td rowSpan={span} className={`${td} font-bold`}>
                            {r.teamPoints == null ? '—' : r.teamPoints}
                          </td>
                          <td rowSpan={span} className={td}>
                            {r.race.hasBundle && (
                              <Link
                                to={`/replay/${r.race.slug}`}
                                className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-ghost px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] shadow-sticker-sm hover:-translate-y-px"
                                aria-label={`Replay R${r.race.round} ${r.race.name}`}
                              >
                                <Play size={10} aria-hidden /> Replay
                              </Link>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <div className="border-t-2 border-ink/15 px-3 py-2 font-mono text-[9px] leading-relaxed text-ink/70">
        Grid / finish / GP points / pit stops from each race bundle (grid "pit" = pit-lane start or no grid slot). Avg lane = mean pit-lane transit of
        stops under 60 s. Notes are the retirement location (OpenF1 location feed) and race-control text where published. *Team pts = constructor
        points gained that round, sprints included.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Teammate head-to-head                                               */
/* ------------------------------------------------------------------ */

function H2HBar({ label, a, b, fmt = (v: number) => String(v), lowerWins = false }: { label: string; a: number | null; b: number | null; fmt?: (v: number) => string; lowerWins?: boolean }) {
  const has = a != null && b != null;
  const winA = has && (lowerWins ? a! < b! : a! > b!);
  const winB = has && (lowerWins ? b! < a! : b! > a!);
  // for count-type stats the bar is a share; for lower-is-better averages, the better side gets the bigger share
  let share = 0.5;
  if (has && a! + b! > 0) share = lowerWins ? b! / (a! + b!) : a! / (a! + b!);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-mono text-[11px] tabular-nums">
        <span className={winA ? 'font-bold text-ink' : 'text-ink/70'}>{a == null ? '—' : fmt(a)}</span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/70">{label}</span>
        <span className={winB ? 'font-bold text-ink' : 'text-ink/70'}>{b == null ? '—' : fmt(b)}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full border-2 border-ink bg-white" aria-hidden>
        <span className="h-full bg-pop-blue" style={{ width: `${share * 100}%` }} />
        <span className="h-full flex-1 bg-pop-pink" />
      </div>
    </div>
  );
}

function HeadToHeadCard({ h }: { h: HeadToHead | null }) {
  if (!h)
    return (
      <div className="rounded-2xl border-[2.5px] border-ink bg-cream-light p-4 font-mono text-[11px] text-ink/75 shadow-sticker">
        No teammate pairing in the data.
      </div>
    );
  return (
    <div className="rounded-2xl border-[2.5px] border-ink bg-cream-light p-4 text-ink shadow-sticker">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link to={`/drivers/${h.a.code}`} className="flex min-w-0 items-center gap-2 hover:underline">
          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-ink bg-pop-blue" />
          <span className="truncate font-display text-2xl uppercase leading-none tracking-wide">{h.a.lastName}</span>
        </Link>
        <span className="font-mono text-[10px] font-bold text-ink/60">VS</span>
        <Link to={`/drivers/${h.b.code}`} className="flex min-w-0 items-center justify-end gap-2 text-right hover:underline">
          <span className="truncate font-display text-2xl uppercase leading-none tracking-wide">{h.b.lastName}</span>
          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-ink bg-pop-pink" />
        </Link>
      </div>
      <div className="space-y-3">
        <H2HBar label="Qualifying" a={h.qualifying[0]} b={h.qualifying[1]} />
        <H2HBar label="Race" a={h.race[0]} b={h.race[1]} />
        <H2HBar label="Points" a={h.points[0]} b={h.points[1]} />
        <H2HBar label="Avg finish" a={h.avgFinish[0]} b={h.avgFinish[1]} lowerWins fmt={(v) => `P${v.toFixed(1)}`} />
        <H2HBar label="Avg quali gap" a={h.avgQualiGap[0]} b={h.avgQualiGap[1]} lowerWins fmt={(v) => `${v.toFixed(2)}%`} />
      </div>
      <p className="mt-3 font-mono text-[9px] leading-relaxed text-ink/70">
        {h.shared} rounds together. Qualifying: lower gap to the session's fastest lap wins. Race: better classified finish wins; a finisher beats a
        retirement. Averages over classified results / sessions with data.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function TeamGarage({ season, team }: { season: SeasonData; team: Team }) {
  const teamId = team.id;
  const done = useMemo(() => completedIndices(season), [season]);
  const ordered = useMemo(() => teamsByStanding(season), [season]);
  const ach = useMemo(() => teamAchievements(season, teamId), [season, teamId]);
  const h2h = useMemo(() => headToHead(season, teamId), [season, teamId]);
  const pens = useMemo(() => teamPenaltySummary(season, teamId), [season, teamId]);
  const [raceIndex, setRaceIndex] = useState<number>(done[done.length - 1] ?? 0);
  const [explode, setExplode] = useState(0.6);
  const [scrollLink, setScrollLink] = useState(true);
  const [hoveredPart, setHoveredPart] = useState<CarPartId | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chalk = textOn(team.color) === 'chalk';

  // race bundles (grid, pits, reliability) load lazily in the background
  const slugs = useMemo(() => done.map((i) => season.races[i]).filter((r) => r.hasBundle).map((r) => r.slug), [done, season]);
  const { bundles, done: bundlesDone } = useRaceBundles(slugs);
  const bundleList = useMemo(() => Object.values(bundles), [bundles]);
  const sheet = useMemo(() => teamSheet(season, teamId, bundleList), [season, teamId, bundleList]);
  const rounds = useMemo(() => raceByRace(season, teamId, bundles), [season, teamId, bundles]);
  const partsDrivers = useMemo(() => ach.drivers.slice(0, 2).map((d) => d.driver), [ach]);

  // upgrade highlight for the scrubbed round
  const race = season.races[raceIndex];
  const teamUpgrades = sheet.upgrades;
  const activeUpgrades = teamUpgrades.filter((u) => u.round === race?.round);
  const highlightKey = activeUpgrades.flatMap((u) => UPGRADE_AREA_PARTS[u.area]).join(',');
  const highlight = useMemo(() => (highlightKey ? (Array.from(new Set(highlightKey.split(','))) as CarPartId[]) : []), [highlightKey]);

  // scroll-linked expansion of the exploded assembly
  useEffect(() => {
    if (!scrollLink) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = stageRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (window.innerHeight * 0.35 - r.top) / (r.height * 0.55)));
        setExplode(0.35 + p * 0.65);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
    };
  }, [scrollLink]);

  const xLabels = done.map((i) => `R${season.races[i].round}`);
  const pick = <T,>(arr: (T | null)[] | undefined) => done.map((i) => (arr ? arr[i] ?? null : null));

  // points progression: this team vs the leader and the teams directly ahead / behind
  const pointsSeries = useMemo((): Series[] => {
    const st = new Map(season.constructorStandings.map((s) => [s.teamId, s]));
    const me = st.get(teamId);
    const pos = me?.position ?? 0;
    const rivals = season.constructorStandings
      .filter((s) => s.teamId !== teamId && (s.position === 1 || s.position === pos - 1 || s.position === pos + 1))
      .sort((a, b) => a.position - b.position);
    const name = (id: string) => season.teams.find((t) => t.id === id);
    const out: Series[] = [{ id: teamShort(team.name).toUpperCase(), label: team.name, color: team.color, values: pick(me?.pointsByRound) }];
    for (const r of rivals) {
      const t = name(r.teamId);
      if (t) out.push({ id: teamShort(t.name).toUpperCase(), label: `${t.name} (P${r.position})`, color: t.color, values: pick(r.pointsByRound), dashed: true });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, teamId, team, done]);

  const pace = season.teamPace[teamId];
  const upgradeMarkers = teamUpgrades
    .map((u) => ({ index: done.findIndex((i) => season.races[i].round === u.round), label: `${upgradeTitle(u)} (R${u.round})` }))
    .filter((m) => m.index >= 0);

  const scrubPos = Math.max(0, done.indexOf(raceIndex));
  const nextUpgrade = teamUpgrades.find((u) => u.round > (race?.round ?? 0)) ?? teamUpgrades[0];
  const jumpToRound = (round: number) => {
    const idx = season.races.findIndex((r) => r.round === round && r.status === 'completed');
    if (idx >= 0) setRaceIndex(idx);
  };

  const myIdx = ordered.findIndex((t) => t.id === teamId);
  const prev = ordered[(myIdx - 1 + ordered.length) % ordered.length];
  const next = ordered[(myIdx + 1) % ordered.length];
  const lastRound = season.races[done[done.length - 1]]?.round;

  return (
    <main className="theme-paper min-h-screen overflow-x-clip bg-pop-uv">
      {/* ---------------- team-colour hero + exploded stage ---------------- */}
      <section className={`pop-dots relative pb-24 pt-16 sm:pb-28 ${chalk ? 'text-cream' : 'text-ink'}`} style={{ background: team.color }}>
        <div className="pop-halftone" />
        <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6">
          <nav className="mb-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]" aria-label="Team navigation">
            <Link to="/teams" className="inline-flex items-center gap-1.5 rounded-md border-2 border-ink bg-cream px-2 py-1 text-ink shadow-sticker-sm hover:-translate-y-px">
              <ArrowLeft size={12} aria-hidden /> All teams
            </Link>
            <span className="flex gap-1.5">
              <Link to={`/teams/${prev.id}`} className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-cream px-2 py-1 text-ink shadow-sticker-sm hover:-translate-y-px" aria-label={`Previous team: ${prev.name}`}>
                <ChevronLeft size={12} aria-hidden /> {teamShort(prev.name)}
              </Link>
              <Link to={`/teams/${next.id}`} className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-cream px-2 py-1 text-ink shadow-sticker-sm hover:-translate-y-px" aria-label={`Next team: ${next.name}`}>
                {teamShort(next.name)} <ChevronRight size={12} aria-hidden />
              </Link>
            </span>
          </nav>

          <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <div className="inline-flex -rotate-2 items-center gap-2 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink shadow-sticker-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                Constructors' {ordinal(ach.position)} · after R{lastRound}
              </div>
              <h1 className="mt-2 break-words font-display text-[clamp(3rem,8vw,7rem)] uppercase leading-[0.86] [text-shadow:0.045em_0.055em_0_#170F33]">{team.name}</h1>
            </div>
            <div className="flex flex-wrap items-stretch gap-2 pb-1">
              <div className="rotate-1 rounded-lg border-2 border-ink bg-cream px-3 py-1.5 text-ink shadow-sticker">
                <div className="font-mono text-3xl font-bold leading-none tabular-nums">{ach.points}</div>
                <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/70">points</div>
              </div>
              {ach.drivers.slice(0, 2).map((d) => (
                <Link
                  key={d.driver.number}
                  to={`/drivers/${d.driver.code}`}
                  className="flex flex-col justify-center rounded-lg border-2 border-ink bg-cream px-3 py-1.5 text-ink shadow-sticker transition-transform hover:-translate-y-0.5 hover:bg-pop-sun"
                >
                  <span className="font-display text-xl uppercase leading-none tracking-wide">{d.driver.lastName}</span>
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-ink/75">
                    #{d.driver.number} · {ordinal(d.position)} · {d.points} pts
                  </span>
                </Link>
              ))}
            </div>
          </header>

          {/* ---------------- 3D exploded stage ---------------- */}
          <section aria-label="Exploded car" className="overflow-hidden rounded-[22px] border-[3px] border-ink bg-cream text-ink shadow-sticker-lg lg:grid lg:grid-cols-[1fr_360px]">
            <div ref={stageRef} className="relative h-[58vh] min-h-[380px] select-none lg:h-[600px]" style={{ background: STAGE_BG }}>
              <Suspense fallback={<Loader label="Unbolting the car…" />}>
                <ExplodedStage teamId={teamId} carColor={team.color} explode={explode} highlight={highlight} onPartHover={setHoveredPart} hoveredPart={hoveredPart} />
              </Suspense>
              <div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-24px)] -rotate-1 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink shadow-sticker-sm">
                Exploded assembly · <span className="mx-0.5 inline-block h-2 w-2 rounded-full align-middle ring-1 ring-ink" style={{ background: team.color }} />
                {teamShort(team.name)} · R{race?.round}
                <span className="hidden sm:inline"> · drag to rotate</span>
              </div>
              {hoveredPart && (
                <div className="pointer-events-none absolute right-3 top-12 rounded-md border-2 border-ink bg-pop-sun px-2 py-1 font-mono text-[10px] font-bold uppercase text-ink shadow-sticker-sm sm:top-3">
                  {PART_LABEL[hoveredPart]}
                </div>
              )}
              <div className="absolute bottom-3 left-3 right-3 max-w-md rounded-lg border-2 border-ink bg-cream p-2.5 font-mono text-[10px] text-ink shadow-sticker sm:right-auto" aria-live="polite">
                {activeUpgrades.length ? (
                  activeUpgrades.map((u) => (
                    <div key={u.title}>
                      <div className="flex items-center gap-2 font-bold text-ink-blue">
                        <span className="h-2 w-2 rounded-full bg-pop-sun ring-1 ring-ink motion-safe:animate-pulse" />
                        R{u.round} · {upgradeTitle(u)} · {u.source === 'detected' ? 'area unknown' : u.area}
                      </div>
                      <div className="mt-0.5 text-ink">
                        Fuel-corrected race pace {u.paceBefore?.toFixed(2) ?? '—'}% → {u.paceAfter?.toFixed(2) ?? '—'}% to fastest
                        {u.paceDelta != null && <span className="font-bold text-ink-blue"> ({u.paceDelta > 0 ? '+' : ''}{u.paceDelta.toFixed(2)} pp)</span>}
                      </div>
                      <div className="text-ink/70">
                        Highlighting {UPGRADE_AREA_PARTS[u.area].map((p) => PART_LABEL[p]).join(' + ')}
                        {u.source === 'detected' && ' as candidate areas — not confirmed by the team'}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-wrap items-center gap-x-2 text-ink/75">
                    No upgrade marker for {team.name} at R{race?.round}.
                    {nextUpgrade && (
                      <button type="button" className="font-bold text-ink-blue underline underline-offset-2" onClick={() => jumpToRound(nextUpgrade.round)}>
                        Jump to R{nextUpgrade.round} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <aside className="pop-dots scrollbar-thin border-t-[3px] border-ink bg-cream p-4 text-ink lg:max-h-[600px] lg:overflow-y-auto lg:border-l-[3px] lg:border-t-0">
              <PartsAllocationPanel season={season} drivers={partsDrivers} raceIndex={raceIndex} />
            </aside>

            {/* exploded controls */}
            <div className="grid gap-4 border-t-[3px] border-ink bg-cream-light p-4 text-ink lg:col-span-2 lg:grid-cols-[minmax(220px,320px)_1fr]">
              <div>
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/75">
                  <label htmlFor="explode">Explode assembly</label>
                  <span className="rounded-[3px] bg-ink px-1 tabular-nums text-pop-sun">{Math.round(explode * 100)}%</span>
                </div>
                <input
                  id="explode"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(explode * 100)}
                  onChange={(e) => {
                    setScrollLink(false);
                    setExplode(Number(e.target.value) / 100);
                  }}
                  className="w-full accent-[#FF2E88]"
                />
                <label className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink/75">
                  <input type="checkbox" checked={scrollLink} onChange={(e) => setScrollLink(e.target.checked)} className="accent-[#FF2E88]" />
                  Link expansion to page scroll
                </label>
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/75">
                  <label htmlFor="round">Round scrubber</label>
                  <span className="truncate normal-case tracking-normal text-ink">
                    R{race?.round} {race?.name}
                  </span>
                </div>
                <input
                  id="round"
                  type="range"
                  min={0}
                  max={Math.max(0, done.length - 1)}
                  value={scrubPos}
                  aria-valuetext={`Round ${race?.round} ${race?.name}`}
                  onChange={(e) => setRaceIndex(done[Number(e.target.value)])}
                  className="w-full accent-[#2D3BFF]"
                />
                <div className="relative mt-1 h-4">
                  {done.map((idx, k) => {
                    const r = season.races[idx];
                    const up = teamUpgrades.some((u) => u.round === r.round);
                    const left = done.length > 1 ? (k / (done.length - 1)) * 100 : 50;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setRaceIndex(idx)}
                        title={`R${r.round} ${r.circuitName}${up ? ' · pace step' : ''}`}
                        aria-label={`Round ${r.round} ${r.circuitName}${up ? ', pace step' : ''}`}
                        className={`absolute top-0 -translate-x-1/2 font-mono text-[8px] ${idx === raceIndex ? 'font-bold text-ink' : up ? 'text-ink-blue' : 'text-ink/60'} ${
                          k % 2 && !up && idx !== raceIndex ? 'hidden sm:block' : ''
                        }`}
                        style={{ left: `${left}%` }}
                      >
                        {up ? '◆' : r.round}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      {/* ---------------- sunshine data sheet: blueprint + charts ---------------- */}
      <CurvedSheet bg="bg-pop-sun" depth={72} className="pb-24">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <SectionHeading kicker="Blueprint" title="Team stats" />
          <TeamBlueprint team={team} sheet={sheet} ach={ach} />

          <div className="mt-12">
            <SectionHeading kicker="Telemetry" title="Form charts" />
            <div className="grid gap-3 lg:grid-cols-2">
              <LineChart title="Points progression" subtitle="Cumulative constructor points vs the leader and the teams either side" xLabels={xLabels} series={pointsSeries} />
              <LineChart
                title="Qualifying vs race pace"
                subtitle={`${team.name} · gap to fastest per round (%), lower = faster`}
                xLabels={xLabels}
                invert
                yFormat={(v) => `${v.toFixed(1)}%`}
                markers={upgradeMarkers}
                series={[
                  { id: 'Q', label: 'Qualifying', color: '#2D3BFF', values: pick(pace?.qualifying) },
                  { id: 'R', label: 'Race (fuel-corrected)', color: '#D45500', values: pick(pace?.raceFuelCorrected), dashed: true },
                ]}
                footnote={<>Gaps break where there is no data (DNF / no clean laps). ◆ markers: detected {team.name} pace steps.</>}
              />
            </div>
            <div className="mt-3">
              <UpgradeBadges
                upgrades={teamUpgrades}
                teamName={team.name}
                activeRound={race?.round}
                onPick={(round) => {
                  jumpToRound(round);
                  stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              />
            </div>
          </div>
        </div>
      </CurvedSheet>

      {/* ---------------- chalk sheet: race by race + head-to-head ---------------- */}
      <CurvedSheet bg="bg-cream" depth={72} className="pb-24">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <SectionHeading kicker={`${done.length} rounds`} title="Race by race">
            {!bundlesDone && <span className="font-mono text-[10px] font-semibold text-ink/70">Loading race data… {bundleList.length}/{slugs.length}</span>}
          </SectionHeading>
          <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              <RaceTable rounds={rounds} season={season} loading={!bundlesDone} />
            </div>
            <div>
              <div className="mb-2 font-display text-2xl uppercase tracking-wide text-ink">Teammate head-to-head</div>
              <HeadToHeadCard h={h2h} />
            </div>
          </div>
        </div>
      </CurvedSheet>

      {/* ---------------- ultraviolet sheet: penalties ---------------- */}
      <CurvedSheet bg="bg-pop-uv" depth={72} className="pb-24">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <SectionHeading kicker="FIA stewards" title="Penalties & incidents" tone="lime">
            <span className="font-mono text-[10px] font-semibold text-cream/85">
              {pens.sanctions} sanctions{pens.timeSeconds ? ` (+${pens.timeSeconds}s in time penalties)` : ''} · {pens.warnings} warnings / reprimands ·{' '}
              {pens.investigations} investigations · {pens.crashes} crash reports
            </span>
          </SectionHeading>
          <PenaltyLog season={season} teamId={teamId} />
        </div>
      </CurvedSheet>
    </main>
  );
}

export default function TeamDetailPage() {
  const { teamId } = useParams();
  const season = useSeason();
  if (!season)
    return (
      <main className="theme-paper pop-dots min-h-screen bg-pop-pink pt-12">
        <Loader label="Opening the garage…" />
      </main>
    );
  const team = season.teams.find((t) => t.id === teamId);
  if (!team)
    return (
      <main className="theme-paper pop-dots flex min-h-screen flex-col items-center justify-center gap-4 bg-pop-pink px-4 pt-12 text-center text-ink">
        <div className="font-display text-5xl uppercase">No such team</div>
        <p className="font-mono text-[11px]">There is no 2026 constructor with the id “{teamId}”.</p>
        <Link to="/teams" className="rounded-full border-2 border-ink bg-cream px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] shadow-sticker">
          All teams
        </Link>
      </main>
    );
  // key: a different team remounts the garage (fresh scrubber state; the old canvas is disposed)
  return <TeamGarage key={team.id} season={season} team={team} />;
}
