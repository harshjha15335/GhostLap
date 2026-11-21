import type { CarPartId } from '@/components/three/F1Car';
import type {
  Driver,
  IncidentType,
  PartPoolId,
  PartsUsage,
  PenaltyCategory,
  RaceBundle,
  RaceSummary,
  SeasonData,
  Upgrade,
} from '@/types';

/**
 * Pure derivations for /season. Everything here is computed from real data in
 * season.json / race bundles; nothing is invented. Values that cannot be
 * derived return null so the UI can say so.
 */

export type EntityMode = 'drivers' | 'teams';

export interface Entity {
  key: string;
  mode: EntityMode;
  /** short label (driver code / team short name) */
  label: string;
  title: string;
  color: string;
  teamId: string;
  position: number | null;
  points: number;
  number?: number;
}

export const POOLS: PartPoolId[] = ['ICE', 'TC', 'MGU-K', 'ES', 'CE', 'EX', 'GEARBOX'];
export const POOL_LABEL: Record<PartPoolId, string> = {
  ICE: 'Internal combustion engine',
  TC: 'Turbocharger',
  'MGU-K': 'Motor generator unit — kinetic',
  ES: 'Energy store',
  CE: 'Control electronics',
  EX: 'Exhaust systems',
  GEARBOX: 'Gearbox (cassette & case)',
};
/** which exploded sub-assembly each FIA pool lives in (for the counters next to the parts) */
export const POOL_PART: Record<PartPoolId, CarPartId> = {
  ICE: 'ice',
  TC: 'ice',
  'MGU-K': 'ers',
  ES: 'ers',
  CE: 'ers',
  EX: 'ice',
  GEARBOX: 'gearbox',
};

export const UPGRADE_AREA_PARTS: Record<Upgrade['area'], CarPartId[]> = {
  AERO: ['frontWing', 'rearWing'],
  FLOOR: ['floor'],
  PU: ['ice', 'ers'],
  CHASSIS: ['monocoque', 'sidepods'],
  SUSPENSION: ['gearbox'],
  UNKNOWN: ['floor', 'frontWing', 'rearWing'],
};

export const PENALTY_CATEGORIES: PenaltyCategory[] = ['TIME', 'DRIVE_THROUGH', 'STOP_GO', 'GRID', 'WARNING', 'REPRIMAND', 'INVESTIGATION'];
export const INCIDENT_TYPES: IncidentType[] = ['CRASH', 'DNF', 'SC', 'VSC', 'RED'];

export const upgradeTitle = (u: Upgrade) => (u.source === 'detected' ? 'Pace step detected' : u.title);

export function completedIndices(season: SeasonData): number[] {
  return season.races.map((r, i) => (r.status === 'completed' ? i : -1)).filter((i) => i >= 0);
}

export const shortRace = (r: RaceSummary) => `R${r.round} ${r.circuitName}`;

export function teamShort(name: string): string {
  return name.replace(' F1 Team', '').replace(' Racing', '');
}

export function buildEntities(season: SeasonData, mode: EntityMode): Entity[] {
  if (mode === 'drivers') {
    const st = new Map(season.driverStandings.map((s) => [s.driverNumber, s]));
    return season.drivers
      .map((d): Entity => {
        const s = st.get(d.number);
        return {
          key: String(d.number),
          mode,
          label: d.code,
          title: d.fullName,
          color: d.color,
          teamId: d.teamId,
          position: s?.position ?? null,
          points: s?.points ?? 0,
          number: d.number,
        };
      })
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.label.localeCompare(b.label));
  }
  const st = new Map(season.constructorStandings.map((s) => [s.teamId, s]));
  return season.teams
    .map((t): Entity => {
      const s = st.get(t.id);
      return { key: t.id, mode, label: teamShort(t.name), title: t.name, color: t.color, teamId: t.id, position: s?.position ?? null, points: s?.points ?? 0 };
    })
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

/** Team drivers ordered by number of classified results (regular drivers first, substitutes after). */
export function teamDrivers(season: SeasonData, teamId: string): Driver[] {
  const results = new Map(season.driverStandings.map((s) => [s.driverNumber, s.finishByRound.filter((x) => x != null).length]));
  return season.drivers.filter((d) => d.teamId === teamId).sort((a, b) => (results.get(b.number) ?? 0) - (results.get(a.number) ?? 0));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface DriverSheet {
  points: number;
  position: number | null;
  wins: number;
  podiums: number;
  poles: number;
  qualiAvg: number | null;
  raceAvg: number | null;
  /** race (fuel-corrected) minus qualifying gap, percentage points; negative = stronger on Sunday */
  paceDelta: number | null;
  overtakes: number | null;
  starts: number | null;
  dnfs: number;
  sanctions: number;
  warnings: number;
  investigations: number;
  bundlesLoaded: number;
}

export function driverSheet(season: SeasonData, n: number, bundles: RaceBundle[]): DriverSheet {
  const st = season.driverStandings.find((s) => s.driverNumber === n);
  const pace = season.driverPace[n];
  const qs = (pace?.qualifying ?? []).filter((v): v is number => v != null);
  const rs = (pace?.raceFuelCorrected ?? []).filter((v): v is number => v != null);
  const qualiAvg = mean(qs);
  const raceAvg = mean(rs);
  const pens = season.penalties.filter((p) => p.driverNumber === n);
  let overtakes: number | null = null;
  let starts: number | null = null;
  let dnfs = 0;
  if (bundles.length) {
    overtakes = 0;
    starts = 0;
    for (const b of bundles) {
      overtakes += b.events.filter((e) => e.type === 'OVERTAKE' && e.driverNumber === n).length;
      const car = b.cars.find((c) => c.driverNumber === n);
      if (car && car.status !== 'DNS') starts++;
      if (car?.status === 'DNF') dnfs++;
    }
  } else {
    dnfs = season.incidents.filter((i) => i.type === 'DNF' && i.driverNumber === n).length;
  }
  return {
    points: st?.points ?? 0,
    position: st?.position ?? null,
    wins: st?.wins ?? 0,
    podiums: st?.podiums ?? 0,
    poles: season.races.filter((r) => r.pole === n).length,
    qualiAvg,
    raceAvg,
    paceDelta: qualiAvg != null && raceAvg != null ? raceAvg - qualiAvg : null,
    overtakes,
    starts,
    dnfs,
    sanctions: pens.filter((p) => ['TIME', 'DRIVE_THROUGH', 'STOP_GO', 'GRID'].includes(p.category)).length,
    warnings: pens.filter((p) => p.category === 'WARNING' || p.category === 'REPRIMAND').length,
    investigations: pens.filter((p) => p.category === 'INVESTIGATION').length,
    bundlesLoaded: bundles.length,
  };
}

export interface TeamSheet {
  points: number;
  position: number | null;
  wins: number;
  podiums: number;
  /** classified finishes / starts across loaded race bundles */
  reliability: number | null;
  starts: number;
  classified: number;
  /** mean pit-lane time (s) of normal stops (< 60 s, excludes red-flag / garage stops) */
  avgPitLane: number | null;
  pitStops: number;
  upgrades: Upgrade[];
  bundlesLoaded: number;
}

export function teamSheet(season: SeasonData, teamId: string, bundles: RaceBundle[]): TeamSheet {
  const st = season.constructorStandings.find((s) => s.teamId === teamId);
  const nums = new Set(season.drivers.filter((d) => d.teamId === teamId).map((d) => d.number));
  let starts = 0;
  let classified = 0;
  const lanes: number[] = [];
  for (const b of bundles) {
    for (const c of b.cars) {
      if (!nums.has(c.driverNumber)) continue;
      if (c.status !== 'DNS') starts++;
      if (c.status === 'FINISHED') classified++;
      for (const p of c.pits) if (p.laneSeconds > 0 && p.laneSeconds < 60) lanes.push(p.laneSeconds);
    }
  }
  const podiums = season.races.reduce((acc, r) => acc + r.podium.filter((n) => nums.has(n)).length, 0);
  return {
    points: st?.points ?? 0,
    position: st?.position ?? null,
    wins: st?.wins ?? 0,
    podiums,
    reliability: starts ? classified / starts : null,
    starts,
    classified,
    avgPitLane: mean(lanes),
    pitStops: lanes.length,
    upgrades: season.upgrades.filter((u) => u.teamId === teamId).sort((a, b) => a.round - b.round),
    bundlesLoaded: bundles.length,
  };
}

/** Cumulative units used up to (and including) calendar index `idx`; null when there is no usage data. */
export function usedUpTo(usage: PartsUsage | undefined, pool: PartPoolId, idx: number): number | null {
  const arr = usage?.usedByRace[pool];
  if (!arr) return null;
  for (let i = Math.min(idx, arr.length - 1); i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return 0;
}
