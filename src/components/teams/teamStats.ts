import type { CarPartId } from '@/components/three/F1Car';
import type {
  CarFinishStatus,
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
 * Pure derivations for /teams and /teams/:teamId. Everything here is computed from real
 * data in season.json / race bundles; nothing is invented. Values that cannot be derived
 * return null so the UI can say "no data".
 */

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

export const PART_LABEL: Record<CarPartId, string> = {
  frontWing: 'front wing',
  monocoque: 'monocoque',
  floor: 'floor',
  sidepods: 'sidepods',
  ice: 'ICE',
  ers: 'ERS',
  gearbox: 'gearbox',
  rearWing: 'rear wing',
};

export const PENALTY_CATEGORIES: PenaltyCategory[] = ['TIME', 'DRIVE_THROUGH', 'STOP_GO', 'GRID', 'WARNING', 'REPRIMAND', 'INVESTIGATION'];
export const INCIDENT_TYPES: IncidentType[] = ['CRASH', 'DNF', 'SC', 'VSC', 'RED'];
const SANCTIONS: PenaltyCategory[] = ['TIME', 'DRIVE_THROUGH', 'STOP_GO', 'GRID'];

/** Positions that score points in a 2026 Grand Prix. */
export const POINTS_POSITIONS = 10;

export const upgradeTitle = (u: Upgrade) => (u.source === 'detected' ? 'Pace step detected' : u.title);

export function completedIndices(season: SeasonData): number[] {
  return season.races.map((r, i) => (r.status === 'completed' ? i : -1)).filter((i) => i >= 0);
}

export const shortRace = (r: RaceSummary) => `R${r.round} ${r.circuitName}`;

export function teamShort(name: string): string {
  return name.replace(' F1 Team', '').replace(' Racing', '');
}

/** Team drivers ordered by number of classified results (regular drivers first, substitutes after). */
export function teamDrivers(season: SeasonData, teamId: string): Driver[] {
  const results = new Map(season.driverStandings.map((s) => [s.driverNumber, s.finishByRound.filter((x) => x != null).length]));
  const points = new Map(season.driverStandings.map((s) => [s.driverNumber, s.points]));
  return season.drivers
    .filter((d) => d.teamId === teamId)
    .sort((a, b) => (results.get(b.number) ?? 0) - (results.get(a.number) ?? 0) || (points.get(b.number) ?? 0) - (points.get(a.number) ?? 0));
}

/** Constructor standings order (championship position), teams without a standing last. */
export function teamsByStanding(season: SeasonData) {
  const st = new Map(season.constructorStandings.map((s) => [s.teamId, s]));
  return [...season.teams].sort((a, b) => (st.get(a.id)?.position ?? 999) - (st.get(b.id)?.position ?? 999) || a.name.localeCompare(b.name));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/* ------------------------------------------------------------------ */
/* Achievements (season.json only — no race bundles needed)            */
/* ------------------------------------------------------------------ */

export interface DriverLine {
  driver: Driver;
  position: number | null;
  points: number;
  wins: number;
  podiums: number;
  /** classified results */
  results: number;
}

export interface TeamAchievements {
  teamId: string;
  position: number | null;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  /** races where the team's cars finished P1 and P2 */
  oneTwos: number;
  /** best Grand Prix finishing position of either car (null = never classified) */
  bestResult: number | null;
  bestResultCount: number;
  /** classified finishes inside the points (top 10), both cars */
  pointsFinishes: number;
  /** retirements (race-control DNF records), both cars */
  dnfs: number;
  /** completed races where at least one car scored points */
  racesInPoints: number;
  drivers: DriverLine[];
  /** cumulative constructor points per completed round */
  pointsProgression: (number | null)[];
}

export function teamAchievements(season: SeasonData, teamId: string): TeamAchievements {
  const st = season.constructorStandings.find((s) => s.teamId === teamId);
  const drivers = teamDrivers(season, teamId);
  const nums = new Set(drivers.map((d) => d.number));
  const done = completedIndices(season);
  const dst = new Map(season.driverStandings.map((s) => [s.driverNumber, s]));

  let podiums = 0;
  let oneTwos = 0;
  let poles = 0;
  let fastestLaps = 0;
  let winsFromPodium = 0;
  for (const i of done) {
    const r = season.races[i];
    podiums += r.podium.filter((n) => nums.has(n)).length;
    if (r.podium[0] != null && nums.has(r.podium[0])) winsFromPodium++;
    if (r.podium.length >= 2 && nums.has(r.podium[0]) && nums.has(r.podium[1])) oneTwos++;
    if (r.pole != null && nums.has(r.pole)) poles++;
    if (r.fastestLap && nums.has(r.fastestLap.driverNumber)) fastestLaps++;
  }

  let bestResult: number | null = null;
  let bestResultCount = 0;
  let pointsFinishes = 0;
  let racesInPoints = 0;
  for (const i of done) {
    let scored = false;
    for (const d of drivers) {
      const f = dst.get(d.number)?.finishByRound[i];
      if (f == null) continue;
      if (f <= POINTS_POSITIONS) {
        pointsFinishes++;
        scored = true;
      }
      if (bestResult == null || f < bestResult) {
        bestResult = f;
        bestResultCount = 1;
      } else if (f === bestResult) bestResultCount++;
    }
    if (scored) racesInPoints++;
  }

  const dnfs = season.incidents.filter((x) => x.type === 'DNF' && x.driverNumber != null && nums.has(x.driverNumber)).length;

  return {
    teamId,
    position: st?.position ?? null,
    points: st?.points ?? 0,
    wins: st?.wins ?? winsFromPodium,
    podiums,
    poles,
    fastestLaps,
    oneTwos,
    bestResult,
    bestResultCount,
    pointsFinishes,
    dnfs,
    racesInPoints,
    drivers: drivers.map((d) => {
      const s = dst.get(d.number);
      return {
        driver: d,
        position: s?.position ?? null,
        points: s?.points ?? 0,
        wins: s?.wins ?? 0,
        podiums: s?.podiums ?? 0,
        results: s ? s.finishByRound.filter((x) => x != null).length : 0,
      };
    }),
    pointsProgression: done.map((i) => st?.pointsByRound[i] ?? null),
  };
}

/* ------------------------------------------------------------------ */
/* Team sheet (needs race bundles: reliability, pit lane)              */
/* ------------------------------------------------------------------ */

export interface TeamSheet {
  points: number;
  position: number | null;
  wins: number;
  podiums: number;
  /** classified finishes / starts across loaded race bundles */
  reliability: number | null;
  starts: number;
  classified: number;
  /** retirements split by how the car came to rest (OpenF1 location feed) */
  dnfByKind: Record<'crash' | 'stopped' | 'pits' | 'unknown', number>;
  /** mean pit-lane time (s) of normal stops (< 60 s, excludes red-flag / garage stops) */
  avgPitLane: number | null;
  bestPitLane: number | null;
  pitStops: number;
  upgrades: Upgrade[];
  bundlesLoaded: number;
}

/** A pit stop counts as "normal" when its lane time is positive and under a minute. */
export const isNormalStop = (laneSeconds: number) => laneSeconds > 0 && laneSeconds < 60;

export function teamSheet(season: SeasonData, teamId: string, bundles: RaceBundle[]): TeamSheet {
  const st = season.constructorStandings.find((s) => s.teamId === teamId);
  const nums = new Set(season.drivers.filter((d) => d.teamId === teamId).map((d) => d.number));
  let starts = 0;
  let classified = 0;
  const dnfByKind = { crash: 0, stopped: 0, pits: 0, unknown: 0 };
  const lanes: number[] = [];
  for (const b of bundles) {
    for (const c of b.cars) {
      if (!nums.has(c.driverNumber)) continue;
      if (c.status !== 'DNS') starts++;
      if (c.status === 'FINISHED') classified++;
      if (c.status === 'DNF') dnfByKind[c.retirement?.kind ?? 'unknown']++;
      for (const p of c.pits) if (isNormalStop(p.laneSeconds)) lanes.push(p.laneSeconds);
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
    dnfByKind,
    avgPitLane: mean(lanes),
    bestPitLane: lanes.length ? Math.min(...lanes) : null,
    pitStops: lanes.length,
    upgrades: season.upgrades.filter((u) => u.teamId === teamId).sort((a, b) => a.round - b.round),
    bundlesLoaded: bundles.length,
  };
}

/* ------------------------------------------------------------------ */
/* Race-by-race                                                        */
/* ------------------------------------------------------------------ */

export interface CarRoundLine {
  driverNumber: number;
  grid: number | null;
  finish: number | null;
  status: CarFinishStatus | null;
  /** Grand Prix points from the race bundle (null without a bundle) */
  points: number | null;
  pitStops: number | null;
  /** mean lane time of normal stops */
  avgPitLane: number | null;
  /** retirement description from race control / location feed, verbatim where available */
  reason: string | null;
  dnfLap: number | null;
}

export interface RoundLine {
  index: number;
  race: RaceSummary;
  hasBundle: boolean;
  cars: CarRoundLine[];
  /** constructor points scored this round (incl. sprints), from cumulative standings */
  teamPoints: number | null;
}

const KIND_LABEL: Record<'crash' | 'stopped' | 'pits' | 'unknown', string> = {
  crash: 'Crash',
  stopped: 'Stopped on circuit',
  pits: 'Retired in the pits',
  unknown: 'Retired',
};

export function raceByRace(season: SeasonData, teamId: string, bundles: Record<string, RaceBundle>): RoundLine[] {
  const drivers = teamDrivers(season, teamId);
  const nums = new Set(drivers.map((d) => d.number));
  const st = season.constructorStandings.find((s) => s.teamId === teamId);
  const dst = new Map(season.driverStandings.map((s) => [s.driverNumber, s]));
  const done = completedIndices(season);
  return done.map((i, k) => {
    const race = season.races[i];
    const b = bundles[race.slug];
    const cum = st?.pointsByRound[i] ?? null;
    const prevIdx = done[k - 1];
    const prev = prevIdx != null ? st?.pointsByRound[prevIdx] ?? null : 0;
    const teamPoints = cum != null && prev != null ? Math.round((cum - prev) * 10) / 10 : null;
    let cars: CarRoundLine[];
    if (b) {
      cars = b.cars
        .filter((c) => nums.has(c.driverNumber))
        .map((c) => {
          const normal = c.pits.filter((p) => isNormalStop(p.laneSeconds));
          let reason: string | null = null;
          if (c.status === 'DNF') {
            const kind = KIND_LABEL[c.retirement?.kind ?? 'unknown'];
            reason = c.retirement?.message ? `${kind} — ${c.retirement.message}` : kind;
          } else if (c.status === 'DNS') reason = 'Did not start';
          return {
            driverNumber: c.driverNumber,
            grid: c.gridPosition,
            finish: c.finishPosition,
            status: c.status,
            points: c.points,
            pitStops: c.pits.length,
            avgPitLane: mean(normal.map((p) => p.laneSeconds)),
            reason,
            dnfLap: c.dnfLap,
          };
        });
    } else {
      cars = drivers
        .filter((d) => dst.get(d.number)?.finishByRound[i] != null)
        .map((d) => ({
          driverNumber: d.number,
          grid: null,
          finish: dst.get(d.number)?.finishByRound[i] ?? null,
          status: null,
          points: null,
          pitStops: null,
          avgPitLane: null,
          reason: null,
          dnfLap: null,
        }));
    }
    const order = new Map(drivers.map((d, j) => [d.number, j]));
    cars.sort((a, b2) => (order.get(a.driverNumber) ?? 99) - (order.get(b2.driverNumber) ?? 99));
    return { index: i, race, hasBundle: !!b, cars, teamPoints };
  });
}

/* ------------------------------------------------------------------ */
/* Teammate head-to-head                                               */
/* ------------------------------------------------------------------ */

export interface HeadToHead {
  a: Driver;
  b: Driver;
  /** rounds where both have a qualifying pace value; lower gap wins */
  qualifying: [number, number];
  /** rounds where both were classified; better finish wins. A DNF loses to a finisher. */
  race: [number, number];
  points: [number, number];
  /** mean classified finishing position */
  avgFinish: [number | null, number | null];
  /** mean qualifying gap to fastest (%) */
  avgQualiGap: [number | null, number | null];
  /** rounds both took part in */
  shared: number;
}

/** Head-to-head between the team's two regular drivers (null with fewer than two drivers). */
export function headToHead(season: SeasonData, teamId: string): HeadToHead | null {
  const [a, b] = teamDrivers(season, teamId);
  if (!a || !b) return null;
  const sa = season.driverStandings.find((s) => s.driverNumber === a.number);
  const sb = season.driverStandings.find((s) => s.driverNumber === b.number);
  const pa = season.driverPace[a.number];
  const pb = season.driverPace[b.number];
  const q: [number, number] = [0, 0];
  const r: [number, number] = [0, 0];
  const fa: number[] = [];
  const fb: number[] = [];
  const qa: number[] = [];
  const qb: number[] = [];
  let shared = 0;
  for (const i of completedIndices(season)) {
    const qva = pa?.qualifying[i] ?? null;
    const qvb = pb?.qualifying[i] ?? null;
    if (qva != null) qa.push(qva);
    if (qvb != null) qb.push(qvb);
    if (qva != null && qvb != null && qva !== qvb) q[qva < qvb ? 0 : 1]++;
    const xa = sa?.finishByRound[i] ?? null;
    const xb = sb?.finishByRound[i] ?? null;
    if (xa != null) fa.push(xa);
    if (xb != null) fb.push(xb);
    // both entered the round (a value in either pace or finish series)
    const inA = xa != null || qva != null;
    const inB = xb != null || qvb != null;
    if (inA && inB) {
      shared++;
      if (xa != null && xb != null) r[xa < xb ? 0 : 1]++;
      else if (xa != null) r[0]++;
      else if (xb != null) r[1]++;
    }
  }
  return {
    a,
    b,
    qualifying: q,
    race: r,
    points: [sa?.points ?? 0, sb?.points ?? 0],
    avgFinish: [mean(fa), mean(fb)],
    avgQualiGap: [mean(qa), mean(qb)],
    shared,
  };
}

/* ------------------------------------------------------------------ */
/* Penalties                                                           */
/* ------------------------------------------------------------------ */

export function teamPenaltySummary(season: SeasonData, teamId: string) {
  const nums = new Set(season.drivers.filter((d) => d.teamId === teamId).map((d) => d.number));
  const pens = season.penalties.filter((p) => p.driverNumber != null && nums.has(p.driverNumber));
  const incs = season.incidents.filter((p) => p.driverNumber != null && nums.has(p.driverNumber));
  return {
    sanctions: pens.filter((p) => SANCTIONS.includes(p.category)).length,
    timeSeconds: pens.filter((p) => p.category === 'TIME').reduce((a, p) => a + (p.seconds ?? 0), 0),
    warnings: pens.filter((p) => p.category === 'WARNING' || p.category === 'REPRIMAND').length,
    investigations: pens.filter((p) => p.category === 'INVESTIGATION').length,
    crashes: incs.filter((i) => i.type === 'CRASH').length,
    records: pens.length + incs.length,
  };
}

/** Cumulative units used up to (and including) calendar index `idx`; null when there is no usage data. */
export function usedUpTo(usage: PartsUsage | undefined, pool: PartPoolId, idx: number): number | null {
  const arr = usage?.usedByRace[pool];
  if (!arr) return null;
  for (let i = Math.min(idx, arr.length - 1); i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return 0;
}

export const ordinal = (n: number | null) => (n == null ? '—' : `P${n}`);

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const INK_LUM = luminance('#170F33');
const CHALK_LUM = luminance('#FFF7EE');
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** 'ink' or 'chalk' — whichever text colour reads better on a team colour. */
export function textOn(hex: string): 'ink' | 'chalk' {
  const l = luminance(hex);
  return contrast(l, INK_LUM) >= contrast(l, CHALK_LUM) ? 'ink' : 'chalk';
}
