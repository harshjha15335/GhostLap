import type { CarState, RaceBundle, TrackStatusType } from '@/types';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import { GHOST_LANE, GRID_LEAD, GRID_SIDE, GRID_STEP, PIT_LANE_OFFSET } from './dims';
import type { LaneTrack } from './laneTrack';
import { planActive, planInPit, planS, retirePose, type RetirePlan, type RetirePose } from './incidents';
import { KIND_OBSTACLE, KIND_OFF, KIND_PIT, KIND_RACE, type TrafficInput } from './traffic';

/**
 * Timeline states → traffic-resolver input (pure, shared by Cars.tsx and the tests).
 *
 *  - lap 1: cars leave a two-column grid (half a car length + clearance per slot, columns
 *    one car width apart) that closes up over the first part of the lap
 *  - after the flag: each car rolls on and slows down (cool-down lap)
 *  - pit lane: pit offset; red-flag waiting cars queue in two columns
 *  - retirements: staged by lib/incidents.ts (driving on → spinning / pulling off → parked),
 *    from the moment the plan takes over (≤ the end of the last completed lap)
 */
export { GRID_STEP } from './dims';

export interface FieldCtx {
  n: number;
  L: number;
  lt: LaneTrack;
  idxByDriver: Map<number, number>;
  finishTime: Float64Array;
  lastLap: Float64Array;
  slot: Int32Array;
  /** timeline's own grid offset (lap units) */
  gOff: Float64Array;
  plans: (RetirePlan | null)[];
}

export function createFieldCtx(bundle: RaceBundle, timeline: RaceTimeline, lt: LaneTrack, plans: (RetirePlan | null)[]): FieldCtx {
  const n = bundle.cars.length;
  const idxByDriver = new Map<number, number>();
  bundle.cars.forEach((c, i) => idxByDriver.set(c.driverNumber, i));
  const finishTime = new Float64Array(n);
  const lastLap = new Float64Array(n);
  const slot = new Int32Array(n);
  const gOff = new Float64Array(n);
  const gridOrder = [...bundle.cars].sort(
    (a, b) => (a.gridPosition ?? 99) - (b.gridPosition ?? 99) || (a.finishPosition ?? 99) - (b.finishPosition ?? 99),
  );
  bundle.cars.forEach((c, i) => {
    const cum = timeline.cumulative.get(c.driverNumber) ?? [];
    finishTime[i] = c.status === 'FINISHED' ? (cum[cum.length - 1] ?? Infinity) : Infinity;
    lastLap[i] = c.laps[c.laps.length - 1] ?? 90;
    slot[i] = gridOrder.indexOf(c);
    gOff[i] = Math.max(0, -timeline.progressAt(c.driverNumber, 0).progress);
  });
  return { n, L: lt.length, lt, idxByDriver, finishTime, lastLap, slot, gOff, plans };
}

export interface FieldOut {
  input: TrafficInput;
  /** 1 = not drawn at all */
  hidden: Uint8Array;
  /** 1 = transform comes from `poses` (incident / garage), not from the resolver */
  posed: Uint8Array;
  poses: RetirePose[];
  /** lap-1 grid phase (cars sit on their slots) */
  onGrid: Uint8Array;
}

export function createFieldOut(n: number): FieldOut {
  return {
    input: { sTrue: new Float64Array(n), kind: new Uint8Array(n), prefD: new Float32Array(n).fill(NaN), noPass: false },
    hidden: new Uint8Array(n),
    posed: new Uint8Array(n),
    poses: Array.from({ length: n }, () => ({ s: 0, d: 0, yaw: 0, phase: 0 as 0 | 1 | 2, since: 0, speed: 0 })),
    onGrid: new Uint8Array(n),
  };
}

const wrap01 = (f: number) => ((f % 1) + 1) % 1;

export function fillField(
  ctx: FieldCtx,
  states: CarState[],
  t: number,
  ghostDn: number,
  status: TrackStatusType | null,
  out: FieldOut,
): FieldOut {
  const { L, lt } = ctx;
  const inp = out.input;
  inp.noPass = status !== null;
  let waiting = 0;
  for (let k = 0; k < states.length; k++) {
    const s = states[k];
    const i = ctx.idxByDriver.get(s.driverNumber);
    if (i === undefined) continue;
    out.hidden[i] = 0;
    out.posed[i] = 0;
    out.onGrid[i] = 0;
    inp.prefD[i] = NaN;
    const plan = ctx.plans[i];
    if (planActive(plan, t)) {
      // retiring: the plan drives the car to its (real) stop point
      const pose = retirePose(plan, t, lt, out.poses[i]);
      inp.sTrue[i] = pose.s;
      if (pose.phase === 0 && plan.limp) {
        // crawling along the edge: a moving obstacle the field steers around
        out.posed[i] = 1;
        inp.kind[i] = KIND_OBSTACLE;
        inp.prefD[i] = pose.d;
      } else if (pose.phase === 0) {
        if (plan.kind === 'garage' && planInPit(plan, t, L)) {
          inp.kind[i] = KIND_PIT;
          inp.prefD[i] = PIT_LANE_OFFSET;
        } else {
          inp.kind[i] = KIND_RACE;
          if (plan.gridSide && planS(plan, t) < plan.sTake + 0.035 * L) {
            out.onGrid[i] = 1;
            inp.prefD[i] = plan.gridSide * GRID_SIDE;
          }
        }
      } else if (plan.kind === 'garage') {
        out.hidden[i] = pose.phase === 2 ? 1 : 0;
        out.posed[i] = 1;
        inp.kind[i] = KIND_OFF;
      } else {
        out.posed[i] = 1;
        inp.kind[i] = KIND_OBSTACLE;
        inp.prefD[i] = pose.d;
      }
      continue;
    }
    if (s.retired) {
      out.hidden[i] = 1;
      inp.kind[i] = KIND_OFF;
      continue;
    }
    // lap fraction (unwrapped on lap 1 so the grid stagger is continuous)
    let f: number;
    const tf = ctx.finishTime[i];
    if (t >= tf) {
      const since = t - tf;
      f = 0.3 * (1 - Math.exp(-since / (ctx.lastLap[i] * 0.45)));
    } else if (s.progress < 1) {
      const p = s.progress;
      const back = (ctx.slot[i] * GRID_STEP + GRID_LEAD) / L;
      const extra = back - ctx.gOff[i];
      f = p - extra * Math.max(0, 1 - (p + ctx.gOff[i]) * 1.6);
      if (p + ctx.gOff[i] < 0.035) {
        out.onGrid[i] = 1;
        inp.prefD[i] = ctx.slot[i] % 2 ? -GRID_SIDE : GRID_SIDE;
      }
    } else f = s.lapFraction;
    inp.sTrue[i] = wrap01(f) * L;
    // (on lap 1 the grid slots wrap to ~0.97 of the lap: that is not the pit entry)
    if (s.inPit && !(s.lap === 1 && s.progress < 0.5)) {
      inp.kind[i] = KIND_PIT;
      const isWaiting = Math.abs(s.lapFraction - 0.97) < 1e-6;
      inp.prefD[i] = isWaiting ? PIT_LANE_OFFSET + (waiting++ % 2 ? -GRID_SIDE : GRID_SIDE) : PIT_LANE_OFFSET;
    } else {
      inp.kind[i] = KIND_RACE;
      if (s.driverNumber === ghostDn && !out.onGrid[i]) inp.prefD[i] = -GHOST_LANE * 0.8; // room for the ghost
    }
  }
  return out;
}
