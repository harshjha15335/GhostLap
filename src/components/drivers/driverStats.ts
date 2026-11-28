import type { CarFinishStatus, CarRace, Compound, Driver, Incident, Penalty, RaceBundle, RaceSummary, SeasonData } from '@/types';

/**
 * Per-driver season statistics for the driver detail page. Everything is computed from the
 * season file and the per-race bundles; anything the data does not cover stays null ("no data").
 */

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nums = (xs: (number | null | undefined)[]) => xs.filter((v): v is number => v != null && Number.isFinite(v));

/** categories that are an actual sanction (as opposed to warnings / investigations) */
export const SANCTIONS: Penalty['category'][] = ['TIME', 'DRIVE_THROUGH', 'STOP_GO', 'GRID'];

export type RetirementKind = NonNullable<CarRace['retirement']>['kind'];

export interface Retirement {
  idx: number;
  race: RaceSummary;
  status: Exclude<CarFinishStatus, 'FINISHED'>;
  /** lap the car was on when it stopped (1-based), or last lap completed + 1; null if unknown */
  lap: number | null;
  kind: RetirementKind | null;
  /** plain-language reason built from the retirement kind */
  reason: string;
  /** race-control text about this car near the stop, verbatim (null when there is none) */
  message: string | null;
}

export interface RaceRow {
  /** index into season.races */
  idx: number;
  race: RaceSummary;
  /** bundle loaded for this race */
  loaded: boolean;
  /** the driver has a car entry in the bundle (started or DNS) */
  entered: boolean;
  grid: number | null;
  finish: number | null;
  status: CarFinishStatus | null;
  /** Grand Prix points from the race bundle */
  racePoints: number | null;
  /** championship points scored this weekend (cumulative-standings difference; includes sprints) */
  weekendPoints: number | null;
  pits: number | null;
  compounds: Compound[];
  /** driver's own best lap time, seconds */
  bestLap: number | null;
  /** holder of the race's fastest lap */
  fastestLap: boolean;
  overtakesMade: number | null;
  overtakesLost: number | null;
  lapsLed: number | null;
  retirement: Retirement | null;
  penalties: Penalty[];
  qualiGap: number | null;
  raceGap: number | null;
}

export interface TeammateH2H {
  driver: Driver;
  /** [this driver ahead, teammate ahead] over rounds both have a qualifying pace value */
  quali: [number, number];
  /** [this driver ahead, teammate ahead] over rounds both have a classified finish */
  race: [number, number];
}

export interface DriverDetail {
  driver: Driver;
  position: number | null;
  points: number;
  wins: RaceSummary[];
  podiums: RaceSummary[];
  poles: RaceSummary[];
  fastestLaps: RaceSummary[];
  pointsFinishes: number;
  classified: number;
  bestFinish: number | null;
  /** completed rounds (calendar indices) */
  completed: number[];
  /** cumulative points after each completed round */
  progression: { idx: number; race: RaceSummary; points: number | null }[];
  qualiPace: number | null;
  racePace: number | null;
  racePaceFuel: number | null;
  avgFinish: number | null;
  teammates: TeammateH2H[];
  penalties: Penalty[];
  sanctions: Penalty[];
  incidents: Incident[];
  /* --- need race bundles; null until at least one bundle is in --- */
  bundlesLoaded: number;
  bundlesWanted: number;
  starts: number | null;
  avgGrid: number | null;
  avgGained: number | null;
  overtakesMade: number | null;
  overtakesLost: number | null;
  lapsLed: number | null;
  pitStops: number | null;
  retirements: Retirement[];
  rows: RaceRow[];
}

export const RETIREMENT_LABEL: Record<RetirementKind, string> = {
  crash: 'Crash / collision',
  stopped: 'Stopped on circuit',
  pits: 'Retired in the pits',
  unknown: 'Retired (cause not in the data)',
};

/**
 * Laps led, from the lap-time feed: at the end of each lap the leader is the car with the
 * lowest cumulative time among cars that completed that lap. (Lap times are gap-filled by
 * the fetcher, so this is an estimate on laps where timing was interpolated.)
 */
export function lapsLedBy(bundle: Pick<RaceBundle, 'cars'>, n: number): number {
  const cum = bundle.cars.map((c) => {
    let t = 0;
    return c.laps.map((l) => (t += l));
  });
  const maxLaps = Math.max(0, ...cum.map((c) => c.length));
  let led = 0;
  for (let lap = 0; lap < maxLaps; lap++) {
    let best = Infinity;
    let who = -1;
    cum.forEach((c, i) => {
      if (c.length > lap && c[lap] < best) {
        best = c[lap];
        who = bundle.cars[i].driverNumber;
      }
    });
    if (who === n) led++;
  }
  return led;
}

/** weekend points from cumulative standings: difference to the previous round with a value */
export function weekendPoints(pointsByRound: (number | null)[], idx: number): number | null {
  const cur = pointsByRound[idx];
  if (cur == null) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const p = pointsByRound[i];
    if (p != null) return Math.round((cur - p) * 10) / 10;
  }
  return cur;
}

function retirementOf(season: SeasonData, idx: number, car: CarRace): Retirement | null {
  if (car.status === 'FINISHED') return null;
  const race = season.races[idx];
  const r = car.retirement;
  const lap = r?.lap ?? (car.dnfLap != null ? car.dnfLap + 1 : null);
  let message = r?.message ?? null;
  if (!message) {
    // a race-control line about this car within two laps of the stop (crash / collision notes)
    const near = season.incidents.find(
      (i) => i.slug === race.slug && i.driverNumber === car.driverNumber && i.type === 'CRASH' && (lap == null || i.lap == null || Math.abs(i.lap - lap) <= 2),
    );
    message = near?.message ?? null;
  }
  let reason: string;
  if (car.status === 'DNS') reason = 'Did not start';
  else if (car.status === 'DSQ') reason = 'Disqualified';
  else if (r) reason = r.kind === 'stopped' ? (r.onTrack ? 'Stopped on track' : 'Stopped off track') : RETIREMENT_LABEL[r.kind];
  else reason = 'Retired (cause not in the data)';
  return { idx, race, status: car.status, lap: car.status === 'DNS' ? null : lap, kind: r?.kind ?? null, reason, message };
}

export function raceRow(season: SeasonData, idx: number, n: number, bundle: RaceBundle | undefined): RaceRow {
  const race = season.races[idx];
  const st = season.driverStandings.find((s) => s.driverNumber === n);
  const pace = season.driverPace[n];
  const car = bundle?.cars.find((c) => c.driverNumber === n);
  const started = !!car && car.status !== 'DNS';
  return {
    idx,
    race,
    loaded: !!bundle,
    entered: !!car,
    grid: car?.gridPosition ?? null,
    finish: car ? car.finishPosition : (st?.finishByRound[idx] ?? null),
    status: car?.status ?? null,
    racePoints: car ? car.points : null,
    weekendPoints: st ? weekendPoints(st.pointsByRound, idx) : null,
    pits: started ? car.pits.length : null,
    compounds: started ? car.stints.map((s) => s.compound) : [],
    bestLap: car && car.laps.length ? Math.min(...car.laps) : null,
    fastestLap: race.fastestLap?.driverNumber === n,
    overtakesMade: bundle && started ? bundle.events.filter((e) => e.type === 'OVERTAKE' && e.driverNumber === n).length : null,
    overtakesLost: bundle && started ? bundle.events.filter((e) => e.type === 'OVERTAKE' && e.otherDriverNumber === n).length : null,
    lapsLed: bundle && started ? lapsLedBy(bundle, n) : null,
    retirement: car ? retirementOf(season, idx, car) : null,
    penalties: season.penalties.filter((p) => p.slug === race.slug && p.driverNumber === n),
    qualiGap: pace?.qualifying[idx] ?? null,
    raceGap: pace?.race[idx] ?? null,
  };
}

function headToHead(season: SeasonData, n: number, completed: number[]): TeammateH2H[] {
  const me = season.drivers.find((d) => d.number === n);
  if (!me) return [];
  const st = new Map(season.driverStandings.map((s) => [s.driverNumber, s]));
  const out: TeammateH2H[] = [];
  for (const mate of season.drivers.filter((d) => d.teamId === me.teamId && d.number !== n)) {
    const quali: [number, number] = [0, 0];
    const race: [number, number] = [0, 0];
    for (const i of completed) {
      const a = season.driverPace[n]?.qualifying[i];
      const b = season.driverPace[mate.number]?.qualifying[i];
      if (a != null && b != null && a !== b) quali[a < b ? 0 : 1]++;
      const fa = st.get(n)?.finishByRound[i];
      const fb = st.get(mate.number)?.finishByRound[i];
      if (fa != null && fb != null && fa !== fb) race[fa < fb ? 0 : 1]++;
    }
    if (quali[0] + quali[1] + race[0] + race[1] > 0) out.push({ driver: mate, quali, race });
  }
  return out.sort((a, b) => b.quali[0] + b.quali[1] + b.race[0] + b.race[1] - (a.quali[0] + a.quali[1] + a.race[0] + a.race[1]));
}

/** rounds the driver has data for (classified result, points entry or pace value) */
export function driverRounds(season: SeasonData, n: number): number[] {
  const st = season.driverStandings.find((s) => s.driverNumber === n);
  const pace = season.driverPace[n];
  return season.races
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => r.status === 'completed' && (st?.finishByRound[i] != null || st?.pointsByRound[i] != null || pace?.qualifying[i] != null || pace?.race[i] != null))
    .map(({ i }) => i);
}

/** race slugs whose bundles the detail page should load for this driver */
export function bundleSlugs(season: SeasonData, n: number): string[] {
  return driverRounds(season, n)
    .map((i) => season.races[i])
    .filter((r) => r.hasBundle)
    .map((r) => r.slug);
}

export function buildDriverDetail(season: SeasonData, n: number, bundles: Record<string, RaceBundle>): DriverDetail | null {
  const driver = season.drivers.find((d) => d.number === n);
  if (!driver) return null;
  const st = season.driverStandings.find((s) => s.driverNumber === n);
  const pace = season.driverPace[n];
  const completed = season.races.map((r, i) => (r.status === 'completed' ? i : -1)).filter((i) => i >= 0);
  const mine = driverRounds(season, n);
  const races = season.races;

  const finishes = nums(mine.map((i) => st?.finishByRound[i]));
  const rows = mine.map((i) => raceRow(season, i, n, bundles[races[i].slug]));
  const wanted = mine.filter((i) => races[i].hasBundle);
  const loadedRows = rows.filter((r) => r.loaded);
  const any = loadedRows.length > 0;
  const started = loadedRows.filter((r) => r.entered && r.status !== 'DNS');
  const sum = (xs: (number | null)[]) => nums(xs).reduce((a, b) => a + b, 0);
  const gained = started.filter((r) => r.grid != null && r.finish != null).map((r) => r.grid! - r.finish!);
  const penalties = season.penalties.filter((p) => p.driverNumber === n);

  return {
    driver,
    position: st?.position ?? null,
    points: st?.points ?? 0,
    wins: races.filter((r) => r.status === 'completed' && r.podium[0] === n),
    podiums: races.filter((r) => r.status === 'completed' && r.podium.includes(n)),
    poles: races.filter((r) => r.pole === n),
    fastestLaps: races.filter((r) => r.fastestLap?.driverNumber === n),
    pointsFinishes: finishes.filter((f) => f <= 10).length,
    classified: finishes.length,
    bestFinish: finishes.length ? Math.min(...finishes) : null,
    completed,
    progression: completed.map((i) => ({ idx: i, race: races[i], points: st?.pointsByRound[i] ?? null })),
    qualiPace: mean(nums(pace?.qualifying ?? [])),
    racePace: mean(nums(pace?.race ?? [])),
    racePaceFuel: mean(nums(pace?.raceFuelCorrected ?? [])),
    avgFinish: mean(finishes),
    teammates: headToHead(season, n, completed),
    penalties,
    sanctions: penalties.filter((p) => SANCTIONS.includes(p.category)),
    incidents: season.incidents.filter((i) => i.driverNumber === n),
    bundlesLoaded: loadedRows.length,
    bundlesWanted: wanted.length,
    starts: any ? started.length : null,
    avgGrid: any ? mean(nums(loadedRows.map((r) => r.grid))) : null,
    avgGained: any ? mean(gained) : null,
    overtakesMade: any ? sum(started.map((r) => r.overtakesMade)) : null,
    overtakesLost: any ? sum(started.map((r) => r.overtakesLost)) : null,
    lapsLed: any ? sum(started.map((r) => r.lapsLed)) : null,
    pitStops: any ? sum(started.map((r) => r.pits)) : null,
    retirements: rows.map((r) => r.retirement).filter((r): r is Retirement => r != null),
    rows,
  };
}

/** "1:22.091" */
export function fmtLap(s: number | null): string {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, '0')}`;
}

export const fmtSigned = (v: number | null, digits = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`);
