import { useMemo } from 'react';
import type { Driver, SeasonData } from '@/types';

/** Fixed palette used while season data is loading (11 teams x 2). */
export const FALLBACK_COLORS = [
  '#F47600', '#4781D7', '#ED1131', '#00D7B6', '#229971', '#00A1E8',
  '#1868DB', '#6C98FF', '#F50537', '#9C9FA2', '#909090',
];

export interface FlowCar {
  code: string;
  color: string;
  team: string;
}

export interface LandingStats {
  ready: boolean;
  racesTotal: number;
  completed: number;
  cancelled: number;
  poleWins: number;
  top3QualiWins: number;
  distinctWinners: number;
  upgradeSteps: number;
  upgradeTeams: number;
  biggestUpgrade: { team: string; color: string; round: number; delta: number } | null;
  penaltiesIssued: number;
  timePenalties: number;
  driveThroughs: number;
  stewardsNotes: number;
  investigations: number;
  overtakes: number;
  safetyCars: number;
  vscs: number;
  redFlags: number;
  neutralisedRaces: number;
  leader: { code: string; color: string; points: number } | null;
  /** the 22 race drivers: two per team, by starts */
  grid: FlowCar[];
}

function pickGrid(season: SeasonData): FlowCar[] {
  const starts = new Map<number, number>();
  season.driverStandings.forEach((s) => starts.set(s.driverNumber, s.finishByRound.filter((p) => p != null).length));
  const byTeam = new Map<string, Driver[]>();
  season.drivers.forEach((d) => {
    const arr = byTeam.get(d.teamId) ?? [];
    arr.push(d);
    byTeam.set(d.teamId, arr);
  });
  const out: FlowCar[] = [];
  season.teams.forEach((t) => {
    const ds = (byTeam.get(t.id) ?? []).sort((a, b) => (starts.get(b.number) ?? 0) - (starts.get(a.number) ?? 0));
    ds.slice(0, 2).forEach((d) => out.push({ code: d.code, color: t.color || d.color, team: t.name }));
  });
  return out.slice(0, 22);
}

const EMPTY: LandingStats = {
  ready: false,
  racesTotal: 0,
  completed: 0,
  cancelled: 0,
  poleWins: 0,
  top3QualiWins: 0,
  distinctWinners: 0,
  upgradeSteps: 0,
  upgradeTeams: 0,
  biggestUpgrade: null,
  penaltiesIssued: 0,
  timePenalties: 0,
  driveThroughs: 0,
  stewardsNotes: 0,
  investigations: 0,
  overtakes: 0,
  safetyCars: 0,
  vscs: 0,
  redFlags: 0,
  neutralisedRaces: 0,
  leader: null,
  grid: Array.from({ length: 22 }, (_, i) => ({ code: '···', color: FALLBACK_COLORS[Math.floor(i / 2)], team: '' })),
};

/** All numbers derived from real season data; zeros + ready=false while loading. */
export function useLandingStats(season: SeasonData | null): LandingStats {
  return useMemo(() => {
    if (!season) return EMPTY;
    const done = season.races.filter((r) => r.status === 'completed');
    const winners = new Set<number>();
    let poleWins = 0;
    let top3 = 0;
    done.forEach((r) => {
      const w = r.podium[0];
      if (w == null) return;
      winners.add(w);
      if (r.pole != null && r.pole === w) poleWins++;
      if (r.qualifyingTop3.includes(w)) top3++;
    });
    const teamsById = new Map(season.teams.map((t) => [t.id, t]));
    const big = season.upgrades
      .filter((u) => u.paceDelta != null)
      .sort((a, b) => (a.paceDelta as number) - (b.paceDelta as number))[0];
    const pens = season.penalties;
    const issued = pens.filter((p) => ['TIME', 'DRIVE_THROUGH', 'STOP_GO', 'GRID'].includes(p.category));
    const lead = [...season.driverStandings].sort((a, b) => a.position - b.position)[0];
    const leadDriver = lead ? season.drivers.find((d) => d.number === lead.driverNumber) : undefined;
    const grid = pickGrid(season);
    return {
      ready: true,
      racesTotal: season.races.filter((r) => r.status !== 'cancelled').length,
      completed: done.length,
      cancelled: season.races.filter((r) => r.status === 'cancelled').length,
      poleWins,
      top3QualiWins: top3,
      distinctWinners: winners.size,
      upgradeSteps: season.upgrades.length,
      upgradeTeams: new Set(season.upgrades.map((u) => u.teamId)).size,
      biggestUpgrade: big
        ? {
            team: teamsById.get(big.teamId)?.name ?? big.teamId,
            color: teamsById.get(big.teamId)?.color ?? '#FFD23F',
            round: big.round,
            delta: big.paceDelta as number,
          }
        : null,
      penaltiesIssued: issued.length,
      timePenalties: pens.filter((p) => p.category === 'TIME').length,
      driveThroughs: pens.filter((p) => p.category === 'DRIVE_THROUGH' || p.category === 'STOP_GO').length,
      stewardsNotes: pens.length,
      investigations: pens.filter((p) => p.category === 'INVESTIGATION').length,
      overtakes: done.reduce((a, r) => a + r.overtakeCount, 0),
      safetyCars: done.reduce((a, r) => a + r.safetyCars, 0),
      vscs: done.reduce((a, r) => a + r.virtualSafetyCars, 0),
      redFlags: done.reduce((a, r) => a + r.redFlags, 0),
      neutralisedRaces: done.filter((r) => r.safetyCars + r.virtualSafetyCars + r.redFlags > 0).length,
      leader:
        lead && leadDriver
          ? { code: leadDriver.code, color: teamsById.get(leadDriver.teamId)?.color ?? leadDriver.color, points: lead.points }
          : null,
      grid: grid.length >= 22 ? grid : [...grid, ...EMPTY.grid.slice(grid.length)],
    };
  }, [season]);
}
