import type { Driver, DriverStanding, SeasonData, Team } from '@/types';

/** One race driver on the Drivers page, joined with team + standings data. */
export interface RosterEntry {
  driver: Driver;
  team: Team;
  standing: DriverStanding | null;
  /** classified race results in the season data (rounds with a finishing position) */
  results: number;
}

export interface Roster {
  /** team order = constructors' championship order; drivers inside a team by championship position */
  teams: { team: Team; drivers: RosterEntry[] }[];
  /** every race driver, by championship position */
  drivers: RosterEntry[];
  /** drivers in the data who are not one of a team's two race drivers (reserves / substitutes) */
  reserves: RosterEntry[];
}

const resultsOf = (s: DriverStanding | null) => (s ? s.finishByRound.filter((f) => f != null).length : 0);

/**
 * The season's race drivers: for each team, the two drivers with the most classified results
 * in the season data (ties broken by points, then car number). OpenF1 also lists reserves and
 * one-off substitutes for a team; those land in `reserves`.
 */
export function buildRoster(season: Pick<SeasonData, 'drivers' | 'teams' | 'driverStandings' | 'constructorStandings'>, perTeam = 2): Roster {
  const standings = new Map(season.driverStandings.map((s) => [s.driverNumber, s]));
  const teamPos = new Map(season.constructorStandings.map((c) => [c.teamId, c.position]));
  const entries: RosterEntry[] = [];
  for (const driver of season.drivers) {
    const team = season.teams.find((t) => t.id === driver.teamId);
    if (!team) continue;
    const standing = standings.get(driver.number) ?? null;
    entries.push({ driver, team, standing, results: resultsOf(standing) });
  }

  const byChampionship = (a: RosterEntry, b: RosterEntry) =>
    (a.standing?.position ?? 999) - (b.standing?.position ?? 999) || a.driver.number - b.driver.number;

  const teams: Roster['teams'] = [];
  const reserves: RosterEntry[] = [];
  for (const team of season.teams) {
    const mine = entries
      .filter((e) => e.team.id === team.id)
      .sort((a, b) => b.results - a.results || (b.standing?.points ?? 0) - (a.standing?.points ?? 0) || a.driver.number - b.driver.number);
    const race = mine.slice(0, perTeam).sort(byChampionship);
    reserves.push(...mine.slice(perTeam));
    if (race.length) teams.push({ team, drivers: race });
  }
  teams.sort((a, b) => (teamPos.get(a.team.id) ?? 99) - (teamPos.get(b.team.id) ?? 99) || a.team.name.localeCompare(b.team.name));

  return {
    teams,
    drivers: teams.flatMap((t) => t.drivers).sort(byChampionship),
    reserves: reserves.sort(byChampionship),
  };
}
