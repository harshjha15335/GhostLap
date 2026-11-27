import type { RaceBundle, RaceEvent } from '@/types';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import type { CornerRun } from '@/components/track/trackModel';
import { sampleLane, type LaneTrack } from './laneTrack';
import { PIT_LANE_OFFSET, PIT_SPAN } from './dims';

/**
 * Retirement staging for the replay.
 *
 * The data tells us WHEN a car stopped (it completed `laps.length` laps) and, through
 * race-control messages, sometimes that it was in a collision ("TURN 13 INCIDENT
 * INVOLVING CARS 87 (BEA) …"). It does not say WHERE on the lap the car stopped, so the
 * replay stages it illustratively:
 *   - garage : the car pitted on its last completed lap → it rolls into its garage
 *   - crash  : a CRASH message names the car within [-1, +6] laps of its retirement
 *              (race control notes incidents a few laps late) → it spins
 *              off at the corner the message names (the n-th detected corner — an
 *              approximation of the official numbering) or, without a turn number, at a
 *              corner picked from the driver number
 *   - stop   : anything else (cause unknown) → it slows and pulls off at the outside of
 *              a corner exit, hazard lights on, no debris
 * The car then STAYS there for the rest of the replay. HUD texts quote the data verbatim.
 */
export type RetireKind = 'crash' | 'stop' | 'garage';

export interface RetirePlan {
  driverNumber: number;
  kind: RetireKind;
  /** timeline retirement time (end of the last completed lap) */
  tRetire: number;
  /** representative lap time used to drive on to the stop point */
  lapTime: number;
  /** arc position (render units) where the incident starts */
  sStop: number;
  /** time the car reaches sStop */
  tStop: number;
  /** +1 → comes to rest off the right edge, −1 → left */
  side: 1 | -1;
  /** turn number from the message, if any */
  turn: number | null;
  /** race-control message (verbatim) or null */
  message: string | null;
  /** seed for debris etc. */
  seed: number;
}

export interface RetirePose {
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

export const SLIDE_SECONDS = 6;

function involves(e: RaceEvent, dn: number) {
  if (e.driverNumber === dn || e.otherDriverNumber === dn) return true;
  return new RegExp(`(^|[^0-9])${dn} \\(`).test(e.message);
}

export function planRetirements(bundle: RaceBundle, timeline: RaceTimeline, lt: LaneTrack, corners: CornerRun[]): (RetirePlan | null)[] {
  const L = lt.length;
  const lap1: number[] = [];
  for (const c of bundle.cars) if (c.laps.length) lap1.push(c.laps[Math.min(1, c.laps.length - 1)]);
  lap1.sort((a, b) => a - b);
  const typicalLap = lap1[lap1.length >> 1] || 90;
  return bundle.cars.map((car) => {
    const n = car.laps.length;
    if (car.status === 'FINISHED' || car.status === 'DNS' || car.status === 'DSQ') return null;
    if (car.status !== 'DNF') return null;
    const cum = timeline.cumulative.get(car.driverNumber) ?? [];
    const tRetire = n ? cum[n - 1] : 0;
    const lapTime = n ? Math.min(car.laps[n - 1], typicalLap * 1.4) : typicalLap;
    const seed = (car.driverNumber * 2654435761) >>> 0;
    const garage = n > 0 && car.pits.some((p) => p.lap === n);
    if (garage) {
      const sStop = PIT_SPAN * 0.45 * L;
      return { driverNumber: car.driverNumber, kind: 'garage', tRetire, lapTime, sStop, tStop: tRetire + 2, side: 1, turn: null, message: null, seed };
    }
    const crash = bundle.events.find((e) => e.type === 'CRASH' && involves(e, car.driverNumber) && e.lap >= n - 1 && e.lap <= n + 6);
    const turnMatch = crash ? /TURN (\d+)/i.exec(crash.message) : null;
    const turn = turnMatch ? Number(turnMatch[1]) : null;
    const cs = corners.length ? corners : null;
    let sStop: number;
    let side: 1 | -1;
    if (cs) {
      const idx = turn != null ? Math.min(cs.length, Math.max(1, turn)) - 1 : (car.driverNumber * 7 + n * 3) % cs.length;
      const c = cs[idx];
      const nS = lt.n;
      const span = (c.end - c.apex + nS) % nS;
      const at = crash ? c.apex : (c.apex + Math.round(span * 0.8)) % nS; // stops: corner exit
      sStop = (at / nS) * L;
      side = c.sign > 0 ? -1 : 1; // outside of the corner
    } else {
      sStop = ((car.driverNumber * 0.137) % 0.8 + 0.1) * L;
      side = 1;
    }
    // never right on the pit straight
    if (sStop < PIT_SPAN * L * 1.2 || sStop > L * (1 - PIT_SPAN * 1.2)) sStop = PIT_SPAN * L * 1.5;
    const tStop = tRetire + (sStop / L) * lapTime;
    const dnf = bundle.events.find((e) => e.type === 'DNF' && e.driverNumber === car.driverNumber);
    return {
      driverNumber: car.driverNumber,
      kind: crash ? 'crash' : 'stop',
      tRetire,
      lapTime,
      sStop,
      tStop,
      side,
      turn,
      message: crash?.message ?? dnf?.message ?? null,
      seed,
    };
  });
}

/** Pose of a retiring / retired car at time t (only meaningful for t ≥ plan.tRetire). */
export function retirePose(p: RetirePlan, t: number, lt: LaneTrack, out: RetirePose): RetirePose {
  const L = lt.length;
  const v0 = L / p.lapTime;
  if (p.kind === 'garage') {
    // roll down the pit lane from the line to the garage and park on the garage side
    const tau = Math.max(0, t - p.tRetire);
    const k = Math.min(1, tau / 6);
    const e = 1 - (1 - k) * (1 - k);
    out.s = p.sStop * e;
    out.d = PIT_LANE_OFFSET + 0.9 * Math.max(0, (k - 0.6) / 0.4);
    out.yaw = 0.9 * Math.min(1, Math.max(0, (k - 0.6) / 0.4));
    out.phase = k >= 1 ? 2 : 1;
    out.since = tau;
    out.speed = (1 - k) * v0 * 0.25;
    return out;
  }
  const d0 = sampleLane(lt.line, lt, p.sStop);
  if (t < p.tStop) {
    out.s = ((t - p.tRetire) / p.lapTime) * L;
    out.d = sampleLane(lt.line, lt, out.s);
    out.yaw = 0;
    out.phase = 0;
    out.since = 0;
    out.speed = v0;
    return out;
  }
  const tau = t - p.tStop;
  if (p.kind === 'crash') {
    const tc = 0.9;
    const ex = Math.exp(-tau / tc);
    out.s = p.sStop + v0 * tc * 1.1 * (1 - ex);
    const sRest = p.sStop + v0 * tc * 1.1;
    const edge = p.side > 0 ? sampleLane(lt.hi, lt, sRest) + 1.75 : sampleLane(lt.lo, lt, sRest) - 1.75;
    const kd = 1 - Math.exp(-tau / 1.15);
    out.d = d0 + (edge - d0) * kd * kd * (3 - 2 * kd);
    out.yaw = -p.side * (Math.PI * 2.35) * (1 - Math.exp(-tau / 1.05));
    out.speed = v0 * ex;
  } else {
    const ts = 2.2;
    const ex = Math.exp(-tau / ts);
    out.s = p.sStop + v0 * ts * (1 - ex);
    const sRest = p.sStop + v0 * ts;
    const edge = p.side > 0 ? sampleLane(lt.hi, lt, sRest) + 1.25 : sampleLane(lt.lo, lt, sRest) - 1.25;
    const kd = Math.min(1, tau / 4.5);
    const sm = kd * kd * (3 - 2 * kd);
    out.d = d0 + (edge - d0) * sm;
    out.yaw = p.side * (0.55 * Math.sin(Math.PI * Math.min(1, kd * 1.3)) * (1 - kd) + 0.22 * sm);
    out.speed = v0 * ex;
  }
  out.phase = tau >= SLIDE_SECONDS ? 2 : 1;
  out.since = tau;
  return out;
}
