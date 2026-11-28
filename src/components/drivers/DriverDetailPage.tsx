import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { Penalty, SeasonData } from '@/types';
import { useSeason } from '@/store/seasonStore';
import Loader from '@/components/ui/Loader';
import { useMediaQuery } from '@/components/ui/hooks';
import { CurvedSheet, SectionHeading, StatPlate, fmtPct } from '@/components/ui/primitives';
import { TYRE_COLORS, TYRE_LETTER } from '@/components/ui/TyreBadge';
import { buildRoster, type RosterEntry } from './roster';
import { loadManifest, mediaFor, type MediaManifest } from './driverMedia';
import { RevealContext, useRevealEngineHost } from './revealContext';
import { RevealFrame } from './DriverCard';
import { buildDriverDetail, bundleSlugs, fmtLap, fmtSigned, SANCTIONS, type DriverDetail, type RaceRow } from './driverStats';
import { useDriverBundles } from './useDriverBundles';
import PointsChart, { type PointsSeries } from './PointsChart';
import { driverHref } from './driverLinks';

const PENALTY_LABEL: Record<Penalty['category'], string> = {
  TIME: 'Time penalty',
  DRIVE_THROUGH: 'Drive-through',
  STOP_GO: 'Stop-go',
  GRID: 'Grid penalty',
  WARNING: 'Warning',
  REPRIMAND: 'Reprimand',
  INVESTIGATION: 'Investigation',
  OTHER: 'Other',
};

function BackLink({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/drivers"
      className={`inline-flex items-center gap-1.5 rounded-md border-2 border-ink px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] shadow-sticker-sm hover:-translate-y-px ${
        light ? 'bg-cream text-ink' : 'bg-white text-ink'
      }`}
    >
      <ArrowLeft size={14} /> All drivers
    </Link>
  );
}

function Card({ title, kicker, children, className = '' }: { title: string; kicker?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border-2 border-ink bg-white p-4 shadow-sticker ${className}`}>
      {kicker && <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-ink/60">{kicker}</div>}
      <h3 className="font-display text-2xl uppercase leading-none tracking-wide text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const pending = <span className="text-ink/40">…</span>;
const NoData = ({ children = 'no data' }: { children?: ReactNode }) => <span className="font-mono text-[11px] text-ink/50">{children}</span>;

function RaceList({ races }: { races: { slug: string; round: number; circuitName: string; name: string }[] }) {
  if (!races.length) return <NoData>none</NoData>;
  return (
    <ul className="flex flex-wrap gap-1">
      {races.map((r) => (
        <li key={r.slug}>
          <Link
            to={`/replay/${r.slug}`}
            title={`${r.name}: open the replay`}
            className="inline-block rounded-[4px] border-[1.5px] border-ink bg-cream px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink hover:bg-pop-sun"
          >
            R{r.round} {r.circuitName}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function H2HBar({ label, a, b, color }: { label: string; a: number; b: number; color: string }) {
  const total = a + b;
  return (
    <div>
      <div className="flex justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/70">
        <span>{label}</span>
        <span className="tabular-nums text-ink">
          {a} – {b}
        </span>
      </div>
      <div className="mt-1 flex h-3 overflow-hidden rounded-full border-[1.5px] border-ink bg-ink/10">
        {total > 0 && (
          <>
            <span style={{ width: `${(a / total) * 100}%`, background: color }} />
            <span className="border-l-2 border-cream bg-ink/30" style={{ width: `${(b / total) * 100}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

function FinishCell({ row }: { row: RaceRow }) {
  if (row.status === 'FINISHED' || (!row.loaded && row.finish != null)) {
    const f = row.finish;
    return (
      <span
        className={`inline-block min-w-[2.2rem] rounded-[4px] border-[1.5px] border-ink px-1 text-center font-bold ${f === 1 ? 'bg-pop-sun' : f != null && f <= 3 ? 'bg-pop-sky' : f != null && f <= 10 ? 'bg-white' : 'bg-ink/[0.06]'}`}
      >
        {f != null ? `P${f}` : '—'}
      </span>
    );
  }
  if (row.status)
    return (
      <span className="inline-block rounded-[4px] border-[1.5px] border-ink bg-[#D7102A] px-1 font-bold text-white" title={row.retirement?.reason}>
        {row.status}
        {row.retirement?.lap != null ? ` L${row.retirement.lap}` : ''}
      </span>
    );
  if (!row.loaded) return pending;
  return <NoData>not entered</NoData>;
}

function RaceTable({ rows, loadedAll }: { rows: RaceRow[]; loadedAll: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 font-mono text-[12px] text-ink">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-[0.16em] text-ink/70">
            {['Rd', 'Race', 'Grid', 'Result', 'Pts', 'Stops · tyres', 'Best lap', 'Passes', 'Penalties'].map((h, i) => (
              <th key={h} className={`border-b-2 border-ink px-2 py-1.5 font-semibold ${i === 1 ? 'sticky left-0 z-[1] bg-white' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sprint = r.weekendPoints != null && r.racePoints != null ? Math.round((r.weekendPoints - r.racePoints) * 10) / 10 : 0;
            const sanctions = r.penalties.filter((p) => SANCTIONS.includes(p.category) || p.category === 'WARNING' || p.category === 'REPRIMAND');
            return (
              <tr key={r.race.slug} className="align-top odd:bg-cream/60">
                <td className="border-b border-ink/10 px-2 py-1.5 tabular-nums text-ink/70">R{r.race.round}</td>
                <td className="sticky left-0 z-[1] border-b border-ink/10 bg-inherit px-2 py-1.5">
                  <Link to={`/replay/${r.race.slug}`} className="font-semibold underline decoration-ink/30 underline-offset-2 hover:decoration-ink" title={`${r.race.name}: open the replay`}>
                    {r.race.circuitName}
                  </Link>
                </td>
                <td className="border-b border-ink/10 px-2 py-1.5 tabular-nums">{r.grid != null ? `P${r.grid}` : r.loaded ? '—' : pending}</td>
                <td className="border-b border-ink/10 px-2 py-1.5 tabular-nums">
                  <FinishCell row={r} />
                  {r.status === 'FINISHED' && r.grid != null && r.finish != null && r.grid !== r.finish && (
                    <span className={`ml-1 text-[10px] ${r.grid > r.finish ? 'text-ink-green' : 'text-ink-red'}`}>{fmtSigned(r.grid - r.finish, 0)}</span>
                  )}
                </td>
                <td className="border-b border-ink/10 px-2 py-1.5 tabular-nums">
                  {r.weekendPoints ?? (r.racePoints ?? '—')}
                  {sprint > 0 && <span className="block text-[9px] text-ink/60">incl. {sprint} sprint</span>}
                </td>
                <td className="border-b border-ink/10 px-2 py-1.5">
                  {!r.loaded ? (
                    pending
                  ) : r.pits == null ? (
                    '—'
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <span className="tabular-nums">{r.pits}</span>
                      {r.compounds.map((c, i) => (
                        <span
                          key={i}
                          title={c}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 text-[8px] font-bold text-ink"
                          style={{ borderColor: c === 'HARD' ? '#170F33' : TYRE_COLORS[c], background: '#fff' }}
                        >
                          {TYRE_LETTER[c]}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="border-b border-ink/10 px-2 py-1.5 tabular-nums">
                  {r.loaded ? fmtLap(r.bestLap) : pending}
                  {r.fastestLap && <span className="ml-1 rounded-[3px] bg-pop-uv px-1 text-[9px] font-bold text-white">FL</span>}
                </td>
                <td className="border-b border-ink/10 px-2 py-1.5 tabular-nums">{r.overtakesMade != null ? r.overtakesMade : r.loaded ? '—' : pending}</td>
                <td className="border-b border-ink/10 px-2 py-1.5 text-[11px]">
                  {sanctions.length ? (
                    <ul>
                      {sanctions.map((p, i) => (
                        <li key={i} title={p.message}>
                          {PENALTY_LABEL[p.category]}
                          {p.seconds ? ` ${p.seconds}s` : ''}
                          {p.lap != null ? ` · L${p.lap}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink/40">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!loadedAll && <p className="mt-2 font-mono text-[10px] text-ink/60">… = race data still loading</p>}
    </div>
  );
}

function Detail({ season, entry, d, manifest, progress }: { season: SeasonData; entry: RosterEntry; d: DriverDetail; manifest: MediaManifest; progress: ReturnType<typeof useDriverBundles> }) {
  const { driver, team } = entry;
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const engine = useRevealEngineHost(!reducedMotion);
  const rounds = d.progression.map((p) => p.race);
  const standings = season.driverStandings;
  const rival = standings.find((s) => s.position === (d.position === 1 ? 2 : 1));
  const rivalDriver = rival ? season.drivers.find((x) => x.number === rival.driverNumber) : null;
  const series: PointsSeries[] = [{ label: driver.code, values: d.progression.map((p) => p.points), color: '#170F33' }];
  if (rival && rivalDriver)
    series.push({ label: `${rivalDriver.code} (P${rival.position})`, values: d.progression.map((p) => rival.pointsByRound[p.idx] ?? null), color: '#D1146B', dashed: true });
  const pct = progress.total ? Math.round((progress.settled / progress.total) * 100) : 100;
  const sanctionsAndNotes = d.penalties.filter((p) => p.category !== 'INVESTIGATION');
  const investigations = d.penalties.filter((p) => p.category === 'INVESTIGATION');
  const crashes = d.incidents.filter((i) => i.type === 'CRASH');
  const needs = (v: ReactNode) => (d.bundlesLoaded ? v : pending);

  return (
    <RevealContext.Provider value={engine}>
      <div className="theme-paper min-h-screen overflow-x-clip bg-cream pt-12">
        <section className="pop-dots relative bg-pop-blue">
          <div className="pop-halftone pop-halftone-light" />
          <span aria-hidden className="absolute inset-x-0 top-0 h-2 border-b-2 border-ink" style={{ background: team.color }} />
          <div className="relative mx-auto grid max-w-[1400px] gap-6 px-4 pb-24 pt-6 sm:px-6 md:grid-cols-[minmax(0,340px)_1fr] lg:grid-cols-[minmax(0,400px)_1fr] lg:gap-10 lg:pb-28">
            <div className="md:col-span-2">
              <BackLink light />
            </div>
            <div className="mx-auto w-full max-w-[280px] sm:max-w-[360px] md:max-w-none">
              <RevealFrame
                entry={entry}
                media={mediaFor(manifest, driver.code)}
                variant="hero"
                reducedMotion={reducedMotion}
                eager
                sizes="(min-width: 1024px) 400px, (min-width: 768px) 340px, 90vw"
              />
            </div>
            <div className="min-w-0">
              <div className="inline-flex -rotate-1 items-center gap-2 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink shadow-sticker-sm">
                #{driver.number} · {driver.code} · {team.name}
              </div>
              <h1 className="mt-2 font-display text-[clamp(2.8rem,8vw,6.5rem)] uppercase leading-[0.86] text-cream [text-shadow:0.045em_0.055em_0_#170F33]">
                <span className="mb-[0.12em] block text-[0.45em] leading-none tracking-[0.04em]">{driver.firstName}</span>
                {driver.lastName}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="rotate-1 rounded-lg border-2 border-ink bg-pop-sun px-3 py-1.5 shadow-sticker">
                  <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/70">Championship</div>
                  <div className="font-display text-4xl leading-none text-ink">{d.position != null ? `P${d.position}` : '—'}</div>
                </div>
                <div className="-rotate-1 rounded-lg border-2 border-ink bg-cream px-3 py-1.5 shadow-sticker">
                  <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/70">Points</div>
                  <div className="font-display text-4xl leading-none text-ink tabular-nums">{d.points}</div>
                </div>
              </div>
              <div className="mt-5 rounded-xl border-2 border-ink bg-cream p-3 shadow-sticker">
                <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/70">Points progression · cumulative, incl. sprints</div>
                <PointsChart rounds={rounds} series={series} />
              </div>
            </div>
          </div>
        </section>

        <CurvedSheet bg="bg-cream" depth={56} className="-mt-12">
          <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-2 sm:px-6">
            {/* load progress */}
            <div className="mb-6" aria-live="polite">
              {!progress.done ? (
                <div className="max-w-md">
                  <div className="flex justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/70">
                    <span>Loading race data</span>
                    <span className="tabular-nums">
                      {progress.settled}/{progress.total}
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full border-[1.5px] border-ink bg-white">
                    <div className="h-full bg-pop-pink transition-[width] duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ) : (
                progress.failed.length > 0 && (
                  <p className="font-mono text-[11px] text-ink-red">
                    Could not load race data for {progress.failed.join(', ')}; those rounds show season-level values only.
                  </p>
                )
              )}
            </div>

            <SectionHeading kicker={`2026 · ${d.classified} classified finishes`} title="Season stats" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatPlate label="Quali pace gap" value={fmtPct(d.qualiPace)} sub="avg % to fastest" />
              <StatPlate label="Race pace gap" value={fmtPct(d.racePace)} sub={`fuel-corr. ${fmtPct(d.racePaceFuel)}`} />
              <StatPlate label="Avg grid" value={needs(d.avgGrid != null ? d.avgGrid.toFixed(1) : '—')} />
              <StatPlate label="Avg finish" value={d.avgFinish != null ? d.avgFinish.toFixed(1) : '—'} sub={d.bestFinish != null ? `best P${d.bestFinish}` : undefined} />
              <StatPlate label="Places gained" value={needs(fmtSigned(d.avgGained))} sub="per classified race" accent={d.avgGained != null && d.avgGained < 0 ? '#C8102E' : '#0A6B2A'} />
              <StatPlate label="Starts" value={needs(d.starts ?? '—')} sub={`${d.retirements.filter((r) => r.status === 'DNF').length} DNF`} />
              <StatPlate label="Wins" value={d.wins.length} accent="#C2005C" />
              <StatPlate label="Podiums" value={d.podiums.length} />
              <StatPlate label="Poles" value={d.poles.length} />
              <StatPlate label="Fastest laps" value={d.fastestLaps.length} />
              <StatPlate label="Points finishes" value={d.pointsFinishes} sub="top-10 classified" />
              <StatPlate label="Laps led" value={needs(d.lapsLed ?? '—')} sub="from lap timing" />
              <StatPlate label="Overtakes made" value={needs(d.overtakesMade ?? '—')} sub={d.overtakesLost != null ? `${d.overtakesLost} lost` : undefined} />
              <StatPlate label="Pit stops" value={needs(d.pitStops ?? '—')} />
              <StatPlate label="Penalties" value={d.sanctions.length} sub="time / drive-through / stop-go / grid" />
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              <Card title="Wins & podiums" kicker="results">
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/70">Wins ({d.wins.length})</div>
                    <RaceList races={d.wins} />
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/70">Podiums ({d.podiums.length})</div>
                    <RaceList races={d.podiums} />
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/70">Poles ({d.poles.length})</div>
                    <RaceList races={d.poles} />
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/70">Fastest laps ({d.fastestLaps.length})</div>
                    <RaceList races={d.fastestLaps} />
                  </div>
                </div>
              </Card>

              <Card title="Teammate head-to-head" kicker="same car">
                {d.teammates.length ? (
                  <div className="space-y-4">
                    {d.teammates.map((t) => (
                      <div key={t.driver.number}>
                        <div className="mb-2 flex items-center justify-between font-mono text-[11px] font-semibold text-ink">
                          <span>
                            {driver.code} vs{' '}
                            <Link to={driverHref(t.driver.code)} className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
                              {t.driver.fullName}
                            </Link>
                          </span>
                        </div>
                        <div className="space-y-2">
                          <H2HBar label="Qualifying (pace)" a={t.quali[0]} b={t.quali[1]} color={team.color} />
                          <H2HBar label="Race (both classified)" a={t.race[0]} b={t.race[1]} color={team.color} />
                        </div>
                      </div>
                    ))}
                    <p className="font-mono text-[10px] leading-relaxed text-ink/60">
                      Qualifying compares each round's best-lap gap to the fastest car; race compares finishing positions in rounds where both were classified.
                    </p>
                  </div>
                ) : (
                  <NoData />
                )}
              </Card>

              <Card title="Retirements" kicker="DNF · DNS · DSQ">
                {!d.bundlesLoaded && !progress.done ? (
                  <NoData>loading race data…</NoData>
                ) : d.retirements.length ? (
                  <ul className="space-y-2.5">
                    {d.retirements.map((r) => (
                      <li key={r.race.slug} className="rounded-md border-[1.5px] border-ink/20 bg-cream/60 p-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-1">
                          <Link to={`/replay/${r.race.slug}`} className="font-mono text-[12px] font-bold text-ink underline decoration-ink/30 underline-offset-2">
                            R{r.race.round} {r.race.circuitName}
                          </Link>
                          <span className="rounded-[3px] bg-[#D7102A] px-1 font-mono text-[10px] font-bold text-white">
                            {r.status}
                            {r.lap != null ? ` · lap ${r.lap}` : ''}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] font-semibold text-ink">{r.reason}</div>
                        <div className="mt-0.5 font-mono text-[10px] leading-snug text-ink/70">
                          {r.message ? <>Race control: “{r.message}”</> : 'No race-control message about this car.'}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <NoData>{progress.done ? 'No retirements: every start ended classified.' : 'loading…'}</NoData>
                )}
              </Card>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card title="Penalties & warnings" kicker="stewards">
                {sanctionsAndNotes.length ? (
                  <ul className="space-y-1.5">
                    {sanctionsAndNotes.map((p, i) => (
                      <li key={i} className="font-mono text-[11px] leading-snug text-ink">
                        <span className={`mr-1.5 inline-block rounded-[3px] px-1 text-[9px] font-bold uppercase ${SANCTIONS.includes(p.category) ? 'bg-[#D7102A] text-white' : 'bg-pop-sun text-ink'}`}>
                          {PENALTY_LABEL[p.category]}
                          {p.seconds ? ` ${p.seconds}s` : ''}
                        </span>
                        R{p.round} {season.races.find((r) => r.slug === p.slug)?.circuitName}
                        {p.lap != null ? `, lap ${p.lap}` : ''}
                        <span className="block text-[10px] text-ink/60">{p.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <NoData>No penalties, warnings or reprimands in the data.</NoData>
                )}
                {investigations.length > 0 && (
                  <p className="mt-3 font-mono text-[10px] text-ink/60">
                    Plus {investigations.length} stewards' investigation{investigations.length === 1 ? '' : 's'} noted (outcomes above when a sanction followed).
                  </p>
                )}
              </Card>
              <Card title="Incidents" kicker="race control">
                {crashes.length ? (
                  <ul className="space-y-1.5">
                    {crashes.map((i, k) => (
                      <li key={k} className="font-mono text-[11px] leading-snug text-ink">
                        R{i.round} {season.races.find((r) => r.slug === i.slug)?.circuitName}
                        {i.lap != null ? `, lap ${i.lap}` : ''}
                        <span className="block text-[10px] text-ink/60">{i.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <NoData>No incidents involving this car in the race-control data.</NoData>
                )}
              </Card>
            </div>

            <div className="mt-10">
              <SectionHeading kicker={`${d.rows.length} rounds`} title="Race by race" />
              <div className="rounded-xl border-2 border-ink bg-white p-4 shadow-sticker">
                <RaceTable rows={d.rows} loadedAll={progress.done} />
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-ink/60">
                Pace gaps: % to the fastest car of the round (OpenF1 lap data). Laps led and passes are counted from the lap-timing and position feeds. Points include sprint
                races where the weekend had one.
              </p>
            </div>
          </div>
        </CurvedSheet>
      </div>
    </RevealContext.Provider>
  );
}

function NotFound({ code }: { code: string }) {
  return (
    <div className="theme-paper min-h-screen bg-cream px-4 pt-24 text-center">
      <p className="font-display text-4xl uppercase text-ink">No 2026 driver “{code.toUpperCase()}”</p>
      <div className="mt-6">
        <BackLink />
      </div>
    </div>
  );
}

function DriverDetailContent({ season, code }: { season: SeasonData; code: string }) {
  const roster = useMemo(() => buildRoster(season), [season]);
  const entry = useMemo(() => {
    const c = code.toUpperCase();
    return [...roster.drivers, ...roster.reserves].find((e) => e.driver.code === c || String(e.driver.number) === code) ?? null;
  }, [roster, code]);
  const n = entry?.driver.number ?? -1;
  const slugs = useMemo(() => (entry ? bundleSlugs(season, n) : []), [season, n, entry]);
  const progress = useDriverBundles(slugs);
  const detail = useMemo(() => (entry ? buildDriverDetail(season, n, progress.bundles) : null), [season, n, entry, progress.bundles]);
  const [manifest, setManifest] = useState<MediaManifest>({ drivers: {} });

  useEffect(() => {
    let alive = true;
    void loadManifest().then((m) => alive && setManifest(m));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (entry) document.title = `${entry.driver.fullName} · Drivers · GhostLap 2026`;
    window.scrollTo(0, 0);
  }, [entry]);

  if (!entry || !detail) return <NotFound code={code} />;
  return <Detail key={entry.driver.code} season={season} entry={entry} d={detail} manifest={manifest} progress={progress} />;
}

/** /drivers/:code: one driver's 2026 season, computed from the season file and race bundles. */
export default function DriverDetailPage() {
  const { code = '' } = useParams<{ code: string }>();
  const season = useSeason();
  if (!season) return <Loader />;
  return <DriverDetailContent season={season} code={code} />;
}
