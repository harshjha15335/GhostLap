/**
 * GhostLap 2026 — shared data contracts.
 *
 * Owned by the integrator (Phase 0). Every subagent builds against these types.
 * Do NOT change a field's meaning; if you need a new field, add it as optional
 * and report it in your hand-off.
 *
 * Units: time in seconds, distance in "lap units" (1.0 = one full lap) unless stated.
 */

export type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET';
export const COMPOUNDS: Compound[] = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

export type RaceStatus = 'completed' | 'cancelled' | 'upcoming';

export interface Team {
  /** kebab id, e.g. "red-bull-racing" */
  id: string;
  name: string;
  /** hex with leading # */
  color: string;
}

export interface Driver {
  number: number;
  /** three-letter acronym, e.g. "NOR" */
  code: string;
  firstName: string;
  lastName: string;
  fullName: string;
  teamId: string;
  color: string;
}

export interface RaceSummary {
  /** official 1-based round number; cancelled events are 0 and skipped in numbering */
  round: number;
  /** unique, from circuit short name: "silverstone", "monza", "kuala-lumpur" … */
  slug: string;
  meetingKey: number;
  sessionKey: number | null;
  /** official meeting name as published, e.g. "British Grand Prix" */
  name: string;
  country: string;
  /** circuit short name, e.g. "Silverstone" */
  circuitName: string;
  /** ISO date of the race */
  date: string;
  status: RaceStatus;
  totalLaps: number | null;
  /** driver numbers P1..P3 (empty unless completed) */
  podium: number[];
  /** pole sitter from Qualifying (null if unknown) */
  pole: number | null;
  /** "pre-race favourites": top 3 of Qualifying */
  qualifyingTop3: number[];
  winnerGapSeconds: number | null;
  safetyCars: number;
  virtualSafetyCars: number;
  redFlags: number;
  dnfCount: number;
  overtakeCount: number;
  fastestLap: { driverNumber: number; time: number } | null;
  /** true when public/data/2026/races/<slug>.json exists */
  hasBundle: boolean;
}

/** A point on the circuit centre line, normalised so the track fits roughly in [-100,100] on x/z. */
export type Vec3 = [number, number, number];

export interface CircuitGeometry {
  slug: string;
  name: string;
  /** approx lap length in km (from data when available) */
  lengthKm: number;
  /**
   * Closed loop of points in render space: [x, y(up/elevation, exaggerated), z].
   * points[0] is the start/finish line, ordered in racing direction. ~300-500 points.
   */
  points: Vec3[];
  /** lap-distance fractions (0..1) where sector 1 and sector 2 end */
  sectorSplits: [number, number];
  /** raw elevation range in metres (for labels), may be approximate */
  elevationRangeM: number;
  /**
   * Optional per-point track half-widths `[left, right]` in render units (same scale as
   * `points`, one pair per point), relative to the racing direction; right = tangent × up.
   * Real widths from the TUMFTM racetrack-database where it covers the circuit, aligned
   * to this centre line; otherwise a uniform default (~12 m). Real-world scale, so
   * renderers usually exaggerate it.
   */
  widths?: [number, number][];
}

export interface Stint {
  compound: Compound;
  /** inclusive lap numbers */
  lapStart: number;
  lapEnd: number;
  tyreAgeAtStart: number;
}

export interface PitStop {
  /** lap on which the car entered the pit lane */
  lap: number;
  /** total pit-lane time in seconds (lane duration) */
  laneSeconds: number;
  /** stationary time, if known */
  stopSeconds: number | null;
}

export type CarFinishStatus = 'FINISHED' | 'DNF' | 'DNS' | 'DSQ';

export interface CarRace {
  driverNumber: number;
  /**
   * Lap times in seconds; index 0 = lap 1. Length = laps completed.
   * Missing laps are filled (interpolated) by the fetcher so the array is gap-free.
   */
  laps: number[];
  /** sector times per lap [s1,s2,s3]; same length as laps; may be estimated */
  sectors: [number, number, number][];
  stints: Stint[];
  pits: PitStop[];
  gridPosition: number | null;
  finishPosition: number | null;
  status: CarFinishStatus;
  /** last lap completed if DNF */
  dnfLap: number | null;
  points: number;
  /** total race time if classified (seconds) */
  raceTime: number | null;
}

export type TrackStatusType = 'SC' | 'VSC' | 'RED';

export interface TrackStatusWindow {
  type: TrackStatusType;
  /** inclusive lap range, from the leader's perspective */
  startLap: number;
  endLap: number;
}

export type RaceEventType =
  | 'PIT'
  | 'OVERTAKE'
  | 'CRASH'
  | 'DNF'
  | 'SC'
  | 'VSC'
  | 'RED'
  | 'PENALTY'
  | 'FASTEST_LAP';

export interface RaceEvent {
  lap: number;
  type: RaceEventType;
  driverNumber?: number;
  otherDriverNumber?: number;
  message: string;
}

export interface RaceBundle {
  summary: RaceSummary;
  circuit: CircuitGeometry;
  totalLaps: number;
  cars: CarRace[];
  trackStatus: TrackStatusWindow[];
  events: RaceEvent[];
  /** median green-flag pit-lane time loss vs a normal lap, seconds */
  pitLossSeconds: number;
  /** representative SC lap time (seconds) */
  safetyCarLapSeconds: number;
}

export type PenaltyCategory =
  | 'TIME'
  | 'DRIVE_THROUGH'
  | 'STOP_GO'
  | 'GRID'
  | 'WARNING'
  | 'REPRIMAND'
  | 'INVESTIGATION'
  | 'OTHER';

export interface Penalty {
  round: number;
  slug: string;
  driverNumber: number | null;
  lap: number | null;
  category: PenaltyCategory;
  seconds: number | null;
  message: string;
}

export type IncidentType = 'CRASH' | 'DNF' | 'RED' | 'SC' | 'VSC';

export interface Incident {
  round: number;
  slug: string;
  lap: number | null;
  driverNumber: number | null;
  type: IncidentType;
  message: string;
}

/**
 * NOTE: every *ByRound array below is indexed by position in SeasonData.races
 * (calendar order, including cancelled/upcoming), NOT by round number.
 */
export interface DriverStanding {
  driverNumber: number;
  points: number;
  position: number;
  wins: number;
  podiums: number;
  /** cumulative points after each round (null for cancelled/upcoming) */
  pointsByRound: (number | null)[];
  /** finishing position per round (null = no result) */
  finishByRound: (number | null)[];
}

export interface ConstructorStanding {
  teamId: string;
  points: number;
  position: number;
  wins: number;
  pointsByRound: (number | null)[];
}

/**
 * Upgrade marker. OpenF1 has no upgrade feed, so these are either
 *  - 'detected': a statistically significant step in the team's pace (computed from real laps), or
 *  - 'editorial': hand-curated in scripts/upgrades_2026.json (empty by default).
 * Pace deltas are always computed from real laps (% gap to fastest; negative = team got faster).
 */
export interface Upgrade {
  teamId: string;
  round: number;
  title: string;
  area: 'AERO' | 'FLOOR' | 'PU' | 'CHASSIS' | 'SUSPENSION' | 'UNKNOWN';
  source: 'detected' | 'editorial';
  /** mean race-pace gap % over up to 3 rounds before / after */
  paceBefore: number | null;
  paceAfter: number | null;
  paceDelta: number | null;
}

export interface PaceSeries {
  /** gap to fastest in % per round (0 = fastest), null when no data */
  qualifying: (number | null)[];
  race: (number | null)[];
  /** race pace corrected for fuel burn (% gap to fastest) */
  raceFuelCorrected: (number | null)[];
}

export interface SeasonData {
  year: 2026;
  generatedAt: string;
  teams: Team[];
  drivers: Driver[];
  /** full calendar incl. cancelled and upcoming */
  races: RaceSummary[];
  driverStandings: DriverStanding[];
  constructorStandings: ConstructorStanding[];
  penalties: Penalty[];
  incidents: Incident[];
  upgrades: Upgrade[];
  driverPace: Record<number, PaceSeries>;
  teamPace: Record<string, PaceSeries>;
  partsAllocation: PartsAllocation;
}

/* ------------------------------------------------------------------ */
/* Replay / simulation runtime types (produced by src/engine)          */
/* ------------------------------------------------------------------ */

export interface CarState {
  driverNumber: number;
  /** current lap number (1-based), clamped to totalLaps */
  lap: number;
  /** 0..1 position along the current lap */
  lapFraction: number;
  /** total progress in lap units (completed laps + lapFraction) */
  progress: number;
  /** 1-based running order */
  position: number;
  gapToLeader: number;
  /** seconds to the car ahead (Infinity for leader) */
  gapAhead: number;
  compound: Compound;
  tyreAge: number;
  inPit: boolean;
  retired: boolean;
  finished: boolean;
}

export interface WhatIfStop {
  lap: number;
  compound: Compound;
}

export interface WhatIfScenario {
  driverNumber: number;
  /** pause lap L0: everything before this lap is real */
  fromLap: number;
  /** complete list of the ghost's pit stops at or after fromLap */
  stops: WhatIfStop[];
  /** remove time penalties (drive-through / stop-go / +Ns) the driver served */
  avoidPenalties: boolean;
}

export interface GhostOvertake {
  lap: number;
  driverNumber: number;
  /** true when the ghost passes the car, false when it is passed */
  gained: boolean;
}

export interface GhostResult {
  scenario: WhatIfScenario;
  /** ghost lap times (index 0 = lap 1), real up to fromLap-1 */
  laps: number[];
  /** cumulative time at end of each lap */
  cumulative: number[];
  totalTime: number;
  realTotalTime: number;
  /** ghost minus real, negative = ghost faster */
  deltaSeconds: number;
  realFinishPosition: number | null;
  ghostFinishPosition: number;
  positionsGained: number;
  /** running position at end of each lap */
  positionByLap: number[];
  overtakes: GhostOvertake[];
  /** one-line human verdict, e.g. "Undercut works: +2 places, P3 → P1 (−4.21s)" */
  verdict: string;
}

export interface WhatIfPreset {
  id: string;
  /** button label, e.g. "Undercut 3 Laps Earlier on Hards" */
  label: string;
  description: string;
  scenario: WhatIfScenario;
  /** pre-computed so the UI can show the expected outcome on the button */
  expected: Pick<GhostResult, 'positionsGained' | 'deltaSeconds' | 'ghostFinishPosition' | 'realFinishPosition'>;
}

export type CameraMode = 'broadcast' | 'topdown' | 'chase';

/** Featured race used for "LAUNCH 3D RACE LAB" and seed fallback data. */
export const DEFAULT_RACE_SLUG = 'silverstone';
export const SEED_RACE_SLUGS = ['melbourne', 'silverstone', 'monza'] as const;

/* ------------------------------------------------------------------ */
/* FIA power-unit / gearbox allocation (no public API — hand-curated)  */
/* ------------------------------------------------------------------ */

export type PartPoolId = 'ICE' | 'TC' | 'MGU-K' | 'ES' | 'CE' | 'EX' | 'GEARBOX';

export interface PartsUsage {
  driverNumber: number;
  /** cumulative units used, per pool, after each race (indexed like SeasonData.races) */
  usedByRace: Partial<Record<PartPoolId, (number | null)[]>>;
}

export interface PartsAllocation {
  /** per-driver seasonal limits; verify against the FIA 2026 Sporting Regulations */
  limits: Record<PartPoolId, number>;
  /** empty until filled from FIA-published PU element lists; UI must show "no data" then */
  usage: PartsUsage[];
  source: string;
}
