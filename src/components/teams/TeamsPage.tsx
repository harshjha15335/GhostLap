import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { SeasonData, Team } from '@/types';
import { useSeason } from '@/store/seasonStore';
import Loader from '@/components/ui/Loader';
import { CurvedSheet, PageTitle } from '@/components/ui/primitives';
import { Sparkline } from './Charts';
import { TeamThumbnailRenderer, useTeamThumbnail, type ThumbJob } from './TeamThumbnails';
import { completedIndices, ordinal, teamAchievements, teamsByStanding, textOn, type TeamAchievements } from './teamStats';

/**
 * /teams — the 11 constructors in championship order, each a bold sticker card in team
 * colours with its W17 (a one-off snapshot, see TeamThumbnails) and achievements computed
 * from season.json.
 */

function CarShot({ team, big }: { team: Team; big: boolean }) {
  const url = useTeamThumbnail(team.id);
  return (
    <div className={`relative ${big ? 'h-[190px] sm:h-[240px]' : 'h-[150px] sm:h-[170px]'}`}>
      {url ? (
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-contain object-bottom drop-shadow-[0_6px_0_rgba(23,15,51,0.25)]" draggable={false} />
      ) : (
        <div className="absolute inset-x-6 bottom-4 flex h-12 items-center justify-center rounded-full bg-ink/15 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-current/80 motion-safe:animate-pulse">
          rolling out the car…
        </div>
      )}
    </div>
  );
}

function Achievement({ label, value, hot }: { label: string; value: string | number; hot?: boolean }) {
  return (
    <div className={`rounded-md border-2 border-ink px-2 py-1.5 ${hot ? 'bg-pop-sun' : 'bg-white'}`}>
      <dt className="truncate font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-ink/70">{label}</dt>
      <dd className="font-mono text-lg font-bold leading-tight tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function TeamCard({ team, ach, maxPoints, big }: { team: Team; ach: TeamAchievements; maxPoints: number; big: boolean }) {
  const chalk = textOn(team.color) === 'chalk';
  const regulars = ach.drivers.slice(0, 2).sort((a, b) => b.points - a.points);
  const subs = ach.drivers.slice(2).filter((d) => d.results > 0);
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-[20px] border-[3px] border-ink bg-cream-light text-ink shadow-sticker transition-transform duration-200 focus-within:-translate-y-1 hover:-translate-y-1 hover:shadow-sticker-lg motion-reduce:transition-none ${
        big ? 'md:col-span-2' : ''
      }`}
    >
      {/* team-colour header */}
      <div className={`pop-dots relative border-b-[3px] border-ink px-4 pt-3 ${chalk ? 'text-cream' : 'text-ink'}`} style={{ background: team.color }}>
        <div className="pop-halftone" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display text-[56px] leading-[0.85] [text-shadow:0.05em_0.06em_0_rgba(23,15,51,0.85)] sm:text-[64px]">{ordinal(ach.position)}</div>
            <h2 className="mt-1 font-display text-[26px] uppercase leading-[0.95] tracking-wide sm:text-[30px]">
              {/* stretched link: the whole card opens the team page */}
              <Link to={`/teams/${team.id}`} className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-[17px] focus-visible:after:ring-4 focus-visible:after:ring-pop-sun">
                {team.name}
              </Link>
            </h2>
          </div>
          <div className="shrink-0 rotate-2 rounded-md border-2 border-ink bg-cream px-2 py-1 text-right text-ink shadow-sticker-sm">
            <div className="font-mono text-2xl font-bold leading-none tabular-nums">{ach.points}</div>
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/70">points</div>
          </div>
        </div>
        <CarShot team={team} big={big} />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <dl className={`grid grid-cols-4 gap-1.5 ${big ? 'lg:grid-cols-8' : ''}`}>
          <Achievement label="Wins" value={ach.wins} hot={ach.wins > 0} />
          <Achievement label="Podiums" value={ach.podiums} hot={ach.podiums > 0} />
          <Achievement label="Poles" value={ach.poles} />
          <Achievement label="Fast laps" value={ach.fastestLaps} />
          <Achievement label="1-2s" value={ach.oneTwos} />
          <Achievement label="Best" value={ach.bestResult == null ? '—' : `P${ach.bestResult}${ach.bestResultCount > 1 ? `×${ach.bestResultCount}` : ''}`} />
          <Achievement label="In points" value={ach.pointsFinishes} />
          <Achievement label="DNFs" value={ach.dnfs} />
        </dl>

        <ul className="grid grid-cols-2 gap-1.5" aria-label={`${team.name} drivers`}>
          {regulars.map((d) => (
            <li key={d.driver.number}>
              <Link
                to={`/drivers/${d.driver.code}`}
                className="relative z-[2] flex items-center justify-between gap-2 rounded-md border-2 border-ink bg-cream px-2 py-1.5 transition-colors hover:bg-pop-sun focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[9px] font-semibold text-ink/70">#{d.driver.number}</span>
                  <span className="block truncate font-display text-[17px] uppercase leading-none tracking-wide">{d.driver.lastName}</span>
                </span>
                <span className="shrink-0 text-right font-mono text-[10px] font-bold tabular-nums">
                  <span className="block">{ordinal(d.position)}</span>
                  <span className="block text-ink-green">{d.points} pts</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {subs.length > 0 && (
          <p className="-mt-1.5 font-mono text-[10px] text-ink/70">
            Also raced:{' '}
            {subs.map((d, i) => (
              <span key={d.driver.number}>
                {i > 0 && ', '}
                <Link to={`/drivers/${d.driver.code}`} className="relative z-[2] font-semibold text-ink underline underline-offset-2">
                  {d.driver.code}
                </Link>{' '}
                ({d.results} {d.results === 1 ? 'race' : 'races'}, {d.points} pts)
              </span>
            ))}
          </p>
        )}

        <div className="mt-auto">
          <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/70">
            <span>Points progression</span>
            <span className="flex items-center gap-1 text-ink transition-transform group-hover:translate-x-0.5">
              Garage <ArrowUpRight size={12} aria-hidden />
            </span>
          </div>
          <Sparkline values={ach.pointsProgression} max={maxPoints} color={chalk ? team.color : '#170F33'} height={big ? 40 : 30} label={`${team.name} cumulative points, ${ach.points} after the latest round`} />
        </div>
      </div>
    </article>
  );
}

function TeamsContent({ season }: { season: SeasonData }) {
  const teams = useMemo(() => teamsByStanding(season), [season]);
  const achievements = useMemo(() => new Map(teams.map((t) => [t.id, teamAchievements(season, t.id)])), [season, teams]);
  const maxPoints = Math.max(1, ...[...achievements.values()].map((a) => a.points));
  const done = completedIndices(season);
  const lastRound = season.races[done[done.length - 1]]?.round;
  const jobs = useMemo<ThumbJob[]>(
    () => teams.map((t) => ({ teamId: t.id, color: t.color, number: achievements.get(t.id)?.drivers[0]?.driver.number })),
    [teams, achievements],
  );
  const totals = useMemo(() => {
    const all = [...achievements.values()];
    return { winners: all.filter((a) => a.wins > 0).length, podium: all.filter((a) => a.podiums > 0).length };
  }, [achievements]);

  return (
    <main className="theme-paper min-h-screen overflow-x-clip bg-pop-uv">
      <TeamThumbnailRenderer jobs={jobs} />
      <section className="pop-dots relative bg-pop-pink pb-20 pt-16">
        <div className="pop-halftone" />
        <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <PageTitle kicker={<>Constructors' championship · after R{lastRound}</>}>Teams</PageTitle>
            <p className="max-w-md pb-2 font-mono text-[11px] leading-relaxed text-ink">
              {teams.length} constructors in championship order. {totals.winners} teams have won a Grand Prix, {totals.podium} have stood on the podium.
              Open a garage for the exploded W17, upgrade markers and every race.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((t, i) => (
              <TeamCard key={t.id} team={t} ach={achievements.get(t.id)!} maxPoints={maxPoints} big={i === 0} />
            ))}
          </div>
        </div>
      </section>
      <CurvedSheet bg="bg-pop-uv" depth={56} className="pb-16">
        <div className="mx-auto max-w-[1600px] px-4 font-mono text-[10px] leading-relaxed text-cream/85 sm:px-6">
          Source: OpenF1 2026 timing data. Wins, podiums, poles and fastest laps count Grand Prix results; constructor points are championship
          totals (sprints included). DNFs are race-control retirements. Car renders use the W17 model by Dave Love (CC-BY) in each team's
          livery.
        </div>
      </CurvedSheet>
    </main>
  );
}

export default function TeamsPage() {
  const season = useSeason();
  if (!season)
    return (
      <main className="theme-paper pop-dots min-h-screen bg-pop-pink pt-12">
        <Loader label="Loading teams…" />
      </main>
    );
  return <TeamsContent season={season} />;
}
