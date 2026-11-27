import type { CarRace, RaceBundle, RaceEvent } from '@/types';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import type { CornerRun } from '@/components/track/trackModel';
import { sampleLane, type LaneTrack } from './laneTrack';
import { GRID_LEAD, GRID_STEP, PIT_LANE_OFFSET, PIT_SPAN } from './dims';

/**
 * Retirement staging for the replay.
 *
 * With `car.retirement` (the OpenF1 location feed, scripts/retirements.py) the replay
 * knows WHERE and WHEN the car came to rest: it follows the timeline until its last
 * completed lap ends (or a little before the stop point, if it stopped short of the
 * line), drives on with the pace of the cars around it, leaves the line and comes to
 * rest exactly at `lapFraction` of lap `lap`, at race time `time`:
 *   - crash   (race control named it in an incident): spins off and slides to the spot
 *   - stopped : slows and pulls over to the edge (on the asphalt if `onTrack`)
 *   - pits    : drives into the pit lane and turns into its garage
 * Without location data (`kind: 'unknown'`, or no `retirement` field) it is staged
 * illustratively, as before: garage if it pitted on its last lap, a spin at the corner a
 * race-control CRASH message names, else a stop at a corner exit.
 * The car then STAYS there for the rest of the replay. HUD texts quote the data verbatim.
 */
export type RetireKind = 'crash' | 'stop' | 'garage';

export interface RetirePlan {
  driverNumber: number;
  kind: RetireKind;
  /** true when the stop point and time come from the location feed */
  exact: boolean;
  /** timeline retirement time (end of the last completed lap) */
  tRetire: number;
  /** the plan takes over from the timeline here (≤ tRetire) */
  tTake: number;
  /** arc positions are unwrapped, relative to the start of the lap after the last completed one */
  sTake: number;
  /** incident starts (car leaves its line / turns into the garage) */
  sStop: number;
  tStop: number;
  /** comes to rest (the real stop point and time when exact) */
  sRest: number;
  tRest: number;
  /** lateral rest offset (render units, + = right of the racing direction) */
  dRest: number;
  /** parked on the asphalt */
  onTrack: boolean;
  /** representative lap time (for cue / signal durations) */
  lapTime: number;
  /** +1 → comes to rest on the right side, −1 → left */
  side: 1 | -1;
  /** turn number from the message, if any */
  turn: number | null;
  /** race-control message (verbatim) or null */
  message: string | null;
  /** seed for debris etc. */
  seed: number;
  /** last completed lap (progress at the line where sTake = 0 would be) */
  lapsDone: number;
  /** drive phase: s at DRIVE_DT steps from tTake (unwrapped) */
  drive: Float32Array;
  driveDt: number;
  /** lap-1 retirement: starts from its grid slot (column side) */
  gridSide: number;
}

export interface RetirePose {
  /** arc position wrapped to 0..L */
  s: number;
  d: number;
  /** heading offset from the track tangent (rad) */
  yaw: number;
  /** 0 driving on, 1 losing it / pulling off, 2 parked */
  phase: 0 | 1 | 2;
  /** seconds since the incident started (≥ 0 once phase ≥ 1) */
  since: number;
  /** speed for airflow etc. (units/s) */
  speed: number;
}

/** incident (leave the line → rest) durations, race seconds */
const SETTLE: Record<RetireKind, number> = { crash: 3.2, stop: 5.5, garage: 3 };
/** kept for consumers that want "a few seconds after the incident started" */
export const SLIDE_SECONDS = 6;
const DRIVE_DT = 0.25;
const PIT_ZONE = 0.065;

function involves(e: RaceEvent, dn: number) {
  if (e.driverNumber === dn || e.otherDriverNumber === dn) return true;
  return new RegExp(`(^|[^0-9])${dn} \\(`).test(e.message);
}

/** shape of the incident curve: g(0) = 0, g(T) = 1, g'(0) = 1 / (tc · (1 − e^(−T/tc))) */
function ease(tau: number, T: number, tc: number) {
  if (tau >= T) return 1;
  return (1 - Math.exp(-tau / tc)) / (1 - Math.exp(-T / tc));
}
const TC: Record<RetireKind, number> = { crash: 0.8, stop: 1.6, garage: 0.9 };

export function planRetirements(bundle: RaceBundle, timeline: RaceTimeline, lt: LaneTrack, corners: CornerRun[]): (RetirePlan | null)[] {
  const L = lt.length;
  const lap1: number[] = [];
  for (const c of bundle.cars) if (c.laps.length) lap1.push(c.laps[Math.min(1, c.laps.length - 1)]);
  lap1.sort((a, b) => a - b);
  const typicalLap = lap1[lap1.length >> 1] || 90;
  const gridOrder = [...bundle.cars].sort(
    (a, b) => (a.gridPosition ?? 99) - (b.gridPosition ?? 99) || (a.finishPosition ?? 99) - (b.finishPosition ?? 99),
  );

  /** timeline progress of a driver at t (sector-shaped, as the replay draws it) */
  const prog = (dn: number, t: number) => timeline.progressAt(dn, t).progress;
  /** time at which a driver reaches progress p (p within its completed laps) */
  const timeAt = (dn: number, p: number, tMax: number) => {
    let lo = 0;
    let hi = tMax;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (prog(dn, mid) < p) lo = mid;
      else hi = mid;
    }
    return hi;
  };

  return bundle.cars.map((car) => {
    if (car.status !== 'DNF') return null;
    const n = car.laps.length;
    const cum = timeline.cumulative.get(car.driverNumber) ?? [];
    const tRetire = n ? cum[n - 1] : 0;
    const lapTime = n ? Math.min(car.laps[n - 1], typicalLap * 1.4) : typicalLap;
    const v0 = L / lapTime;
    const seed = (car.driverNumber * 2654435761) >>> 0;
    const slot = gridOrder.indexOf(car);
    const sGrid = -(slot * GRID_STEP + GRID_LEAD);
    const ret = car.retirement;
    const exact = !!ret && ret.kind !== 'unknown';
    const crashEvt = bundle.events.find((e) => e.type === 'CRASH' && involves(e, car.driverNumber) && e.lap >= n - 1 && e.lap <= n + 6);
    const dnfEvt = bundle.events.find((e) => e.type === 'DNF' && e.driverNumber === car.driverNumber);

    let kind: RetireKind;
    let sRest: number; // unwrapped, relative to the line after lap n
    let tRestWanted: number | null = null;
    let side: 1 | -1 = 1;
    let turn: number | null = null;
    let onTrack = false;
    let message: string | null = null;
    if (exact) {
      kind = ret.kind === 'crash' ? 'crash' : ret.kind === 'pits' ? 'garage' : 'stop';
      let sr = (ret.lap - 1 + ret.lapFraction - n) * L;
      if (kind === 'garage') {
        // the drawn pit lane runs PIT_ZONE either side of the line: keep the garage inside it
        const z = PIT_ZONE * L;
        if (sr > z && sr < L - z) sr = sr < L / 2 ? z : L - z;
        else if (sr < -z) sr = -z;
        else if (sr > L + z) sr = L + z;
      }
      sRest = sr;
      tRestWanted = ret.time;
      onTrack = ret.onTrack;
      message = ret.message ?? dnfEvt?.message ?? null;
      const tm = ret.message ? /TURN (\d+)/i.exec(ret.message) : null;
      turn = tm ? Number(tm[1]) : null;
    } else {
      // illustrative staging (no location data)
      const garage = n > 0 && car.pits.some((p) => p.lap === n);
      const turnMatch = crashEvt ? /TURN (\d+)/i.exec(crashEvt.message) : null;
      turn = turnMatch ? Number(turnMatch[1]) : null;
      message = crashEvt?.message ?? dnfEvt?.message ?? null;
      if (garage) {
        kind = 'garage';
        sRest = PIT_SPAN * 0.45 * L;
      } else {
        kind = crashEvt ? 'crash' : 'stop';
        const cs = corners.length ? corners : null;
        let sStop: number;
        if (cs) {
          const idx = turn != null ? Math.min(cs.length, Math.max(1, turn)) - 1 : (car.driverNumber * 7 + n * 3) % cs.length;
          const c = cs[idx];
          const nS = lt.n;
          const span = (c.end - c.apex + nS) % nS;
          const at = crashEvt ? c.apex : (c.apex + Math.round(span * 0.8)) % nS; // stops: corner exit
          sStop = (at / nS) * L;
        } else sStop = ((car.driverNumber * 0.137) % 0.8 + 0.1) * L;
        // never right on the pit straight
        if (sStop < PIT_SPAN * L * 1.2 || sStop > L * (1 - PIT_SPAN * 1.2)) sStop = PIT_SPAN * L * 1.5;
        sRest = sStop + v0 * TC[kind] * (1 - Math.exp(-SETTLE[kind] / TC[kind]));
      }
    }

    // side to come to rest on: outside of the corner for a crash, away from the racing line otherwise
    {
      let kBest = 0;
      for (let x = -12; x <= 2; x += 1) {
        const kk = sampleLane(lt.kappa, lt, sRest + x);
        if (Math.abs(kk) > Math.abs(kBest)) kBest = kk;
      }
      if (kind === 'crash' && Math.abs(kBest) > 0.02) side = kBest > 0 ? -1 : 1;
      else {
        const line = sampleLane(lt.line, lt, sRest);
        side = Math.abs(line) > 0.15 ? (line > 0 ? -1 : 1) : seed & 1 ? 1 : -1;
      }
    }

    // takeover: at the line after the last completed lap, or before the stop point if it is short of it
    const T = SETTLE[kind];
    const lead = Math.max(0.04 * L, v0 * T * 1.2);
    let sTake: number;
    let tTake: number;
    let gridSide = 0;
    if (n === 0) {
      sTake = sGrid;
      tTake = 0;
      gridSide = slot % 2 ? -1 : 1;
    } else if (sRest - lead >= 0) {
      sTake = 0;
      tTake = tRetire;
    } else {
      const pTake = Math.max(0, n + (sRest - lead) / L);
      tTake = timeAt(car.driverNumber, pTake, tRetire);
      sTake = (prog(car.driverNumber, tTake) - n) * L;
    }
    if (sRest < sTake + 0.5) sRest = sTake + 0.5;

    // natural progress (lap units, n = the line after the last completed lap) for t ≥ tTake:
    // the car's own timeline up to tRetire, then the pace of the car running nearest to it
    const pAtRetire = n === 0 ? -0.0 : n;
    let ref: CarRace | null = null;
    let refGap = Infinity;
    for (const o of bundle.cars) {
      if (o === car || !o.laps.length) continue;
      const oc = timeline.cumulative.get(o.driverNumber) ?? [];
      const oEnd = oc[oc.length - 1] ?? 0;
      if (oEnd < tRetire + 60) continue;
      const g = Math.abs(prog(o.driverNumber, tRetire) - (n === 0 ? prog(o.driverNumber, 0) + 0 : n)) + (n === 0 ? Math.abs(gridOrder.indexOf(o) - slot) * 0.01 : 0);
      if (g < refGap) {
        refGap = g;
        ref = o;
      }
    }
    const natural = (t: number): number => {
      if (t <= tRetire && n > 0) return prog(car.driverNumber, t);
      if (ref) return pAtRetire + (prog(ref.driverNumber, t) - prog(ref.driverNumber, tRetire));
      return pAtRetire + (t - tRetire) / lapTime;
    };

    // incident start: the slide length matches the drive speed at that moment (speed continuity)
    // when would it get to the incident at the natural pace?
    let tLo = tTake;
    let tHi = tTake + 6 * lapTime;
    for (let k = 0; k < 40; k++) {
      const mid = (tLo + tHi) / 2;
      if ((natural(mid) - n) * L < sRest - v0 * TC[kind]) tLo = mid;
      else tHi = mid;
    }
    // the real time, unless that needs more than 1.25× the natural pace (the timeline's lap
    // end and the location feed disagree by a few seconds): then a little later
    const tMin = tTake + Math.max(0.5, (tHi - tTake) / 1.25);
    const tRest = Math.max(tRestWanted ?? tHi + T, tMin + T);
    let tStop = tRest - T;
    // the timeline's lap end can be a little late for a car that stopped short of the line
    const pTake0 = natural(tTake);
    const pNat = (t: number) => natural(t) - pTake0;
    let sStop = sRest - v0 * TC[kind] * (1 - Math.exp(-T / TC[kind]));
    for (let it = 0; it < 4; it++) {
      const span = pNat(tStop) || 1e-6;
      const scale = (sStop - sTake) / (span * L);
      const vNat = ((pNat(tStop) - pNat(tStop - 0.5)) / 0.5) * L;
      const vEnd = Math.max(0.05 * v0, Math.min(1.6 * v0, vNat * scale));
      const slide = vEnd * TC[kind] * (1 - Math.exp(-T / TC[kind]));
      sStop = Math.max(sTake + 0.2, sRest - slide);
    }
    if (sStop >= sRest) sStop = sRest - 0.05;
    tStop = Math.max(tTake, tStop);

    const steps = Math.max(2, Math.ceil((tStop - tTake) / DRIVE_DT) + 1);
    const drive = new Float32Array(steps);
    const span = pNat(tStop);
    for (let k = 0; k < steps; k++) {
      const t = Math.min(tStop, tTake + k * DRIVE_DT);
      const u = span > 1e-6 ? Math.max(0, Math.min(1, pNat(t) / span)) : (t - tTake) / Math.max(1e-3, tStop - tTake);
      drive[k] = sTake + (sStop - sTake) * u;
    }

    // lateral rest point
    const sr = sRest;
    const lo = sampleLane(lt.lo, lt, sr);
    const hi = sampleLane(lt.hi, lt, sr);
    let dRest: number;
    if (kind === 'garage') dRest = PIT_LANE_OFFSET + 0.9;
    else if (onTrack) dRest = side > 0 ? hi : lo;
    else dRest = side > 0 ? hi + (kind === 'crash' ? 1.75 : 1.25) : lo - (kind === 'crash' ? 1.75 : 1.25);

    return {
      driverNumber: car.driverNumber,
      kind,
      exact,
      tRetire,
      tTake,
      sTake,
      sStop,
      tStop,
      sRest,
      tRest,
      dRest,
      onTrack,
      lapTime,
      side,
      turn,
      message,
      seed,
      lapsDone: n,
      drive,
      driveDt: DRIVE_DT,
      gridSide,
    } satisfies RetirePlan;
  });
}

const wrapS = (s: number, L: number) => ((s % L) + L) % L;

/** unwrapped arc position of the plan at time t (≥ tTake) */
export function planS(p: RetirePlan, t: number): number {
  if (t < p.tStop) {
    const f = Math.max(0, (t - p.tTake) / p.driveDt);
    const i = Math.min(p.drive.length - 2, Math.floor(f));
    const k = Math.min(1, f - i);
    return p.drive[i] + (p.drive[i + 1] - p.drive[i]) * k;
  }
  const T = p.tRest - p.tStop;
  return p.sStop + (p.sRest - p.sStop) * ease(t - p.tStop, T, TC[p.kind]);
}

/** visual lap progress of a retiring car (lap units), for the HUD */
export function planProgress(p: RetirePlan, t: number, L: number): number {
  return p.lapsDone + planS(p, t) / L;
}

/** true once the car has come to rest (the tower shows it out from here) */
export function isOut(p: RetirePlan | null | undefined, t: number, timelineRetired: boolean): boolean {
  return p ? t >= p.tRest : timelineRetired;
}

/** the plan drives the car (instead of the timeline) at time t */
export function planActive(p: RetirePlan | null | undefined, t: number): p is RetirePlan {
  return !!p && t >= p.tTake;
}

/** in the pit lane (garage plans) */
export function planInPit(p: RetirePlan, t: number, L: number): boolean {
  if (p.kind !== 'garage') return false;
  const s = wrapS(planS(p, t), L) / L;
  return s > 1 - PIT_ZONE - 0.01 || s < PIT_ZONE + 0.02;
}

/** Pose of a retiring / retired car at time t (only meaningful for t ≥ plan.tTake). */
export function retirePose(p: RetirePlan, t: number, lt: LaneTrack, out: RetirePose): RetirePose {
  const L = lt.length;
  const s = planS(p, Math.max(p.tTake, t));
  out.s = wrapS(s, L);
  const h = 0.1;
  out.speed = Math.max(0, (planS(p, t + h) - planS(p, Math.max(p.tTake, t - h))) / (2 * h));
  if (t < p.tStop) {
    out.d = p.kind === 'garage' && planInPit(p, t, L) ? PIT_LANE_OFFSET : sampleLane(lt.line, lt, out.s);
    out.yaw = 0;
    out.phase = 0;
    out.since = 0;
    return out;
  }
  const tau = t - p.tStop;
  const T = p.tRest - p.tStop;
  const d0 = p.kind === 'garage' ? PIT_LANE_OFFSET : sampleLane(lt.line, lt, wrapS(p.sStop, L));
  if (p.kind === 'crash') {
    const kd = ease(tau, T, 1.0);
    out.d = d0 + (p.dRest - d0) * kd * kd * (3 - 2 * kd);
    out.yaw = -p.side * (Math.PI * 2.35) * ease(tau, T, 0.95);
  } else if (p.kind === 'stop') {
    const kd = Math.min(1, tau / Math.max(0.1, T * 0.85));
    const sm = kd * kd * (3 - 2 * kd);
    out.d = d0 + (p.dRest - d0) * sm;
    out.yaw = p.side * (0.55 * Math.sin(Math.PI * Math.min(1, kd * 1.3)) * (1 - kd) + 0.22 * sm);
  } else {
    const k = Math.min(1, tau / T);
    const sm = k * k * (3 - 2 * k);
    out.d = d0 + (p.dRest - d0) * sm;
    out.yaw = 0.9 * sm;
  }
  out.phase = t >= p.tRest ? 2 : 1;
  out.since = tau;
  return out;
}
