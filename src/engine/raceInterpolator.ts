import type { CarRace, CarState, Compound, GhostResult, RaceBundle, TrackStatusType } from '@/types';

/**
 * Lap-time driven race interpolator.
 *
 * t = 0 is lights out. A car's position on track comes from its cumulative lap
 * times; inside a lap the sector times give a piecewise-linear speed profile
 * mapped onto the circuit's sector-split fractions.
 *
 *  - Start: at t ≤ 0 every car sits on its grid slot, slightly behind the line
 *    (8 m per grid place), so `progress` is slightly negative on lap 1 and
 *    `lapFraction` wraps to just below 1. Lap 1's distance includes that offset.
 *  - Suspended / garage laps (lap time > 2.5× the car's median green lap, e.g.
 *    red flags): the car drives the lap at its normal pace to the pit lane
 *    (97 % of the lap), waits there (`inPit`), then completes the lap.
 *  - Retired cars freeze where they stopped and drop to the back (`retired`).
 *  - Finished cars (incl. lapped ones) wait at the line in classified order.
 *  - Gaps are time-based: how long ago the car ahead / leader was at this
 *    car's current track position.
 *
 * statesAt() runs every frame for ~22 cars: per-car data is precomputed into
 * typed arrays and the scratch buffers are reused; pass `out` to reuse states.
 */
export interface LapProgress {
  lap: number;
  lapFraction: number;
  progress: number;
  finished: boolean;
}

export interface RaceTimeline {
  bundle: RaceBundle;
  totalLaps: number;
  /** seconds until the last classified car takes the flag (+ small cooldown) */
  duration: number;
  /** end-of-lap times per driver (index 0 = end of lap 1) */
  cumulative: Map<number, number[]>;
  /** car states at time t, in running order. Pass `out` to reuse the array and its objects. */
  statesAt(t: number, out?: CarState[]): CarState[];
  progressAt(driverNumber: number, t: number): LapProgress;
  /** lap progress for an arbitrary lap-time series (used for the ghost car) */
  progressForLaps(cumulative: number[], sectors: [number, number, number][] | null, t: number): LapProgress;
  ghostProgressAt(ghost: GhostResult, t: number): LapProgress;
  /** CarState-like snapshot of the ghost (position vs the real field at time t) */
  ghostStateAt(ghost: GhostResult, t: number): CarState;
  /** leader's lap at time t (1-based) */
  leaderLapAt(t: number): number;
  /** time at which the leader starts the given lap */
  timeAtLap(lap: number): number;
  trackStatusAt(t: number): TrackStatusType | null;
}

const GRID_SLOT_M = 8;
const PIT_FRACTION = 0.97;
const SUSPENDED_FACTOR = 2.5;
const PIT_WINDOW = 0.07;

interface CarTrack {
  car: CarRace;
  n: number;
  cum: Float64Array;
  /** sector-1 and sector-1+2 share of each lap (0..1) */
  r1: Float64Array;
  r12: Float64Array;
  /** normal lap time for laps flagged as suspended (0 = normal lap) */
  suspended: Float64Array;
  /** 1 = pit in-lap */
  pitIn: Uint8Array;
  compound: Compound[];
  age: Int32Array;
  gridOffset: number;
  end: number;
  finished: boolean;
  everRuns: boolean;
}

interface Scratch {
  idx: number;
  lap: number;
  frac: number;
  progress: number;
  retired: boolean;
  finished: boolean;
  inPit: boolean;
}

function upperBound(arr: ArrayLike<number>, n: number, t: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function medianOf(xs: number[], d: number): number {
  if (!xs.length) return d;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createRaceTimeline(bundle: RaceBundle): RaceTimeline {
  const { circuit, totalLaps } = bundle;
  const [split1, split2] = circuit.sectorSplits;
  const lapM = Math.max(1000, (circuit.lengthKm || 5) * 1000);
  const neutral = new Set<number>();
  for (const w of bundle.trackStatus) for (let L = w.startLap; L <= w.endLap; L++) neutral.add(L);

  const cumulative = new Map<number, number[]>();
  const tracks: CarTrack[] = [];
  const byNum = new Map<number, CarTrack>();
  const gridOrder = [...bundle.cars].sort(
    (a, b) => (a.gridPosition ?? 99) - (b.gridPosition ?? 99) || (a.finishPosition ?? 99) - (b.finishPosition ?? 99),
  );
  const gridSlot = new Map(gridOrder.map((c, i) => [c.driverNumber, i]));

  for (const car of bundle.cars) {
    const n = car.laps.length;
    const cum = new Float64Array(n);
    const r1 = new Float64Array(n);
    const r12 = new Float64Array(n);
    const suspended = new Float64Array(n);
    const pitIn = new Uint8Array(n + 1);
    let acc = 0;
    const green: number[] = [];
    for (let i = 0; i < n; i++) {
      cum[i] = acc += car.laps[i];
      if (i > 0 && !neutral.has(i + 1)) green.push(car.laps[i]);
      const s = car.sectors[i];
      const tot = s ? s[0] + s[1] + s[2] : 0;
      if (s && tot > 0 && s[0] > 0 && s[1] > 0) {
        r1[i] = s[0] / tot;
        r12[i] = (s[0] + s[1]) / tot;
      } else {
        r1[i] = split1;
        r12[i] = split2;
      }
    }
    const med = medianOf(green, medianOf(car.laps, 90));
    for (let i = 0; i < n; i++) if (car.laps[i] > SUSPENDED_FACTOR * med) suspended[i] = med;
    for (const p of car.pits) if (p.lap >= 1 && p.lap <= n) pitIn[p.lap - 1] = 1;
    const compound: Compound[] = new Array(n);
    const age = new Int32Array(n);
    let k = 0;
    for (let L = 1; L <= n; L++) {
      while (k < car.stints.length - 1 && L > car.stints[k].lapEnd) k++;
      const st = car.stints[k];
      compound[L - 1] = st?.compound ?? 'MEDIUM';
      age[L - 1] = st ? Math.max(0, st.tyreAgeAtStart + L - st.lapStart) : L - 1;
    }
    const tr: CarTrack = {
      car,
      n,
      cum,
      r1,
      r12,
      suspended,
      pitIn,
      compound,
      age,
      gridOffset: ((gridSlot.get(car.driverNumber) ?? 0) * GRID_SLOT_M) / lapM,
      end: n ? cum[n - 1] : 0,
      finished: car.status === 'FINISHED' && n > 0,
      everRuns: n > 0 && car.status !== 'DNS',
    };
    tracks.push(tr);
    byNum.set(car.driverNumber, tr);
    cumulative.set(car.driverNumber, Array.from(cum));
  }

  // leader = first car to complete each lap
  const lead = new Float64Array(totalLaps).fill(Infinity);
  for (const tr of tracks) for (let i = 0; i < Math.min(tr.n, totalLaps); i++) if (tr.cum[i] < lead[i]) lead[i] = tr.cum[i];
  let leadN = 0;
  while (leadN < totalLaps && Number.isFinite(lead[leadN])) leadN++;
  const lastFlag = tracks.reduce((mx, tr) => (tr.finished ? Math.max(mx, tr.end) : mx), 0);
  const duration = (lastFlag > 0 ? lastFlag : leadN ? lead[leadN - 1] : 0) + 5;

  /** fraction 0..1 of lap i covered after `el` seconds; sets pit flag for suspended laps */
  let pitWait = false;
  function frac(cum: ArrayLike<number>, i: number, el: number, r1: number, r12: number, susp: number): number {
    const lapTime = cum[i] - (i === 0 ? 0 : cum[i - 1]);
    pitWait = false;
    if (lapTime <= 0) return 0;
    if (susp > 0) {
      const drive = susp * PIT_FRACTION;
      if (el < drive) return profile(el / susp, r1, r12);
      const tail = susp * (1 - PIT_FRACTION);
      const restart = lapTime - tail;
      if (el < restart) {
        pitWait = true;
        return PIT_FRACTION;
      }
      return PIT_FRACTION + ((el - restart) / tail) * (1 - PIT_FRACTION);
    }
    return profile(el / lapTime, r1, r12);
  }
  /** time share u (0..1) → distance share, via sector time shares vs sector distance splits */
  function profile(u: number, r1: number, r12: number): number {
    if (u <= 0) return 0;
    if (u < r1) return (u / r1) * split1;
    if (u < r12) return split1 + ((u - r1) / (r12 - r1)) * (split2 - split1);
    if (u >= 1) return 1;
    return split2 + ((u - r12) / (1 - r12)) * (1 - split2);
  }
  /** inverse of profile: distance share → time share */
  function profileInv(f: number, r1: number, r12: number): number {
    if (f <= 0) return 0;
    if (f < split1) return (f / split1) * r1;
    if (f < split2) return r1 + ((f - split1) / (split2 - split1)) * (r12 - r1);
    if (f >= 1) return 1;
    return r12 + ((f - split2) / (1 - split2)) * (1 - r12);
  }

  const DEFAULT_R1 = split1;
  const DEFAULT_R12 = split2;

  function progressGeneric(
    cum: ArrayLike<number>,
    n: number,
    t: number,
    gridOffset: number,
    tr: CarTrack | null,
    out: { lap: number; frac: number; progress: number; finished: boolean; pit: boolean },
  ): void {
    out.pit = false;
    if (n === 0 || t <= 0) {
      out.lap = 1;
      out.progress = -gridOffset;
      out.frac = gridOffset > 0 ? 1 - gridOffset : 0;
      out.finished = false;
      return;
    }
    const i = upperBound(cum, n, t);
    if (i >= n) {
      out.lap = n;
      out.frac = 1;
      out.progress = n;
      out.finished = n >= totalLaps;
      return;
    }
    const start = i === 0 ? 0 : cum[i - 1];
    const r1 = tr ? tr.r1[i] : DEFAULT_R1;
    const r12 = tr ? tr.r12[i] : DEFAULT_R12;
    const susp = tr ? tr.suspended[i] : 0;
    let f = frac(cum, i, t - start, r1, r12, susp);
    out.pit = pitWait;
    if (i === 0 && gridOffset > 0) f = -gridOffset + f * (1 + gridOffset);
    out.lap = i + 1;
    out.progress = i + f;
    out.frac = f < 0 ? f + 1 : f;
    out.finished = false;
  }

  /** time at which a car reached `progress` (inverse of progressGeneric) */
  function timeAtProgress(tr: CarTrack, progress: number): number {
    const { cum, n } = tr;
    if (n === 0) return 0;
    if (progress <= -tr.gridOffset) return 0;
    let lapIdx = Math.floor(progress);
    if (lapIdx >= n) return tr.end;
    if (lapIdx < 0) lapIdx = 0;
    const start = lapIdx === 0 ? 0 : cum[lapIdx - 1];
    const lapTime = cum[lapIdx] - start;
    let f = progress - lapIdx;
    if (lapIdx === 0 && tr.gridOffset > 0) f = (progress + tr.gridOffset) / (1 + tr.gridOffset);
    const susp = tr.suspended[lapIdx];
    if (susp > 0) {
      if (f < PIT_FRACTION) return start + profileInv(f, tr.r1[lapIdx], tr.r12[lapIdx]) * susp;
      const tail = susp * (1 - PIT_FRACTION);
      return start + lapTime - tail + ((f - PIT_FRACTION) / (1 - PIT_FRACTION)) * tail;
    }
    return start + profileInv(f, tr.r1[lapIdx], tr.r12[lapIdx]) * lapTime;
  }

  const tmp = { lap: 1, frac: 0, progress: 0, finished: false, pit: false };
  const scratch: Scratch[] = tracks.map((_, idx) => ({ idx, lap: 1, frac: 0, progress: 0, retired: false, finished: false, inPit: false }));
  const order: Scratch[] = scratch.slice();

  function fill(s: Scratch, t: number): void {
    const tr = tracks[s.idx];
    progressGeneric(tr.cum, tr.n, t, tr.gridOffset, tr, tmp);
    s.lap = Math.min(tmp.lap, totalLaps);
    s.frac = tmp.frac;
    s.progress = tmp.progress;
    s.retired = !tr.everRuns || (!tr.finished && t >= tr.end);
    s.finished = tr.finished && t >= tr.end;
    const i = tmp.lap - 1;
    s.inPit =
      !s.retired &&
      !s.finished &&
      (tmp.pit || (tr.pitIn[i] === 1 && tmp.frac > 1 - PIT_WINDOW) || (i > 0 && tr.pitIn[i - 1] === 1 && tmp.frac < PIT_WINDOW));
  }

  function compare(a: Scratch, b: Scratch): number {
    if (a.retired !== b.retired) return a.retired ? 1 : -1;
    const ta = tracks[a.idx];
    const tb = tracks[b.idx];
    if (a.finished && b.finished) return (ta.car.finishPosition ?? 99) - (tb.car.finishPosition ?? 99);
    const d = b.progress - a.progress;
    if (Math.abs(d) > 1e-9) return d;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return (ta.car.finishPosition ?? 99) - (tb.car.finishPosition ?? 99) || a.idx - b.idx;
  }

  function statesAt(t: number, out?: CarState[]): CarState[] {
    for (const s of scratch) fill(s, t);
    order.sort(compare);
    const res = out ?? [];
    res.length = order.length;
    const leader = order[0];
    const leaderTr = leader ? tracks[leader.idx] : null;
    for (let k = 0; k < order.length; k++) {
      const s = order[k];
      const tr = tracks[s.idx];
      const tHere = Math.min(t, Math.max(0, tr.end || t));
      const gapTo = (o: Scratch | null): number => {
        if (!o) return Infinity;
        const otr = tracks[o.idx];
        const p = Math.min(s.progress, otr.n);
        return Math.max(0, tHere - timeAtProgress(otr, p));
      };
      const st = res[k] ?? ({} as CarState);
      st.driverNumber = tr.car.driverNumber;
      st.lap = s.lap;
      st.lapFraction = s.frac;
      st.progress = s.progress;
      st.position = k + 1;
      st.gapToLeader = k === 0 || !leaderTr || s.retired ? 0 : gapTo(leader);
      st.gapAhead = k === 0 ? Infinity : s.retired ? Infinity : gapTo(order[k - 1]);
      const li = Math.max(0, Math.min(tr.n - 1, s.lap - 1));
      st.compound = tr.n ? tr.compound[li] : 'MEDIUM';
      st.tyreAge = tr.n ? tr.age[li] : 0;
      st.inPit = s.inPit;
      st.retired = s.retired;
      st.finished = s.finished;
      res[k] = st;
    }
    return res;
  }

  function progressAt(dn: number, t: number): LapProgress {
    const tr = byNum.get(dn);
    if (!tr) return { lap: 1, lapFraction: 0, progress: 0, finished: false };
    progressGeneric(tr.cum, tr.n, t, tr.gridOffset, tr, tmp);
    return { lap: tmp.lap, lapFraction: tmp.frac, progress: tmp.progress, finished: tmp.finished };
  }

  function progressForLaps(cum: number[], sectors: [number, number, number][] | null, t: number): LapProgress {
    // sector shares from the given sectors (scaled to the lap time), else circuit splits
    let tr: CarTrack | null = null;
    if (sectors && sectors.length) {
      const n = cum.length;
      const r1 = new Float64Array(n);
      const r12 = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const s = sectors[i];
        const tot = s ? s[0] + s[1] + s[2] : 0;
        r1[i] = s && tot > 0 ? s[0] / tot : split1;
        r12[i] = s && tot > 0 ? (s[0] + s[1]) / tot : split2;
      }
      tr = { r1, r12, suspended: new Float64Array(n) } as unknown as CarTrack;
    }
    progressGeneric(cum, cum.length, t, 0, tr, tmp);
    return { lap: tmp.lap, lapFraction: tmp.frac, progress: tmp.progress, finished: tmp.finished };
  }

  /** ghost tracks share the real driver's sector shares, grid slot and suspended-lap handling */
  const ghostCache = new WeakMap<GhostResult, CarTrack>();
  function ghostTrack(ghost: GhostResult): CarTrack {
    let g = ghostCache.get(ghost);
    if (g) return g;
    const base = byNum.get(ghost.scenario.driverNumber);
    const n = ghost.cumulative.length;
    const cum = Float64Array.from(ghost.cumulative);
    const ex = ghost as GhostResult & { compoundByLap?: Compound[]; tyreAgeByLap?: number[]; pitLaps?: number[] };
    const pitIn = new Uint8Array(n + 1);
    for (const L of ex.pitLaps ?? []) if (L >= 1 && L <= n) pitIn[L - 1] = 1;
    const suspended = new Float64Array(n);
    if (base) for (let i = 0; i < Math.min(n, base.n); i++) if (base.suspended[i] > 0 && ghost.laps[i] > SUSPENDED_FACTOR * base.suspended[i]) suspended[i] = base.suspended[i];
    g = {
      car: base?.car ?? bundle.cars[0],
      n,
      cum,
      r1: base?.r1 ?? new Float64Array(n).fill(split1),
      r12: base?.r12 ?? new Float64Array(n).fill(split2),
      suspended,
      pitIn,
      compound: ex.compoundByLap ?? base?.compound ?? new Array(n).fill('MEDIUM'),
      age: Int32Array.from(ex.tyreAgeByLap ?? Array.from(base?.age ?? [])),
      gridOffset: base?.gridOffset ?? 0,
      end: n ? cum[n - 1] : 0,
      finished: base?.finished ?? true,
      everRuns: n > 0,
    };
    ghostCache.set(ghost, g);
    return g;
  }

  function ghostProgressAt(ghost: GhostResult, t: number): LapProgress {
    const g = ghostTrack(ghost);
    progressGeneric(g.cum, g.n, t, g.gridOffset, g, tmp);
    return { lap: tmp.lap, lapFraction: tmp.frac, progress: tmp.progress, finished: tmp.finished };
  }

  function ghostStateAt(ghost: GhostResult, t: number): CarState {
    const g = ghostTrack(ghost);
    progressGeneric(g.cum, g.n, t, g.gridOffset, g, tmp);
    const progress = tmp.progress;
    const lap = Math.min(tmp.lap, totalLaps);
    const frac0 = tmp.frac;
    const pit = tmp.pit;
    const finished = g.finished && t >= g.end;
    // position vs the real field (excluding the real driver)
    let position = 1;
    let bestAhead: CarTrack | null = null;
    let bestAheadP = Infinity;
    for (const s of scratch) {
      const tr = tracks[s.idx];
      if (tr.car.driverNumber === ghost.scenario.driverNumber) continue;
      progressGeneric(tr.cum, tr.n, t, tr.gridOffset, tr, tmp);
      const retired = !tr.everRuns || (!tr.finished && t >= tr.end);
      if (retired) continue;
      if (tmp.progress > progress) {
        position++;
        if (tmp.progress < bestAheadP) {
          bestAheadP = tmp.progress;
          bestAhead = tr;
        }
      }
    }
    const tHere = Math.min(t, g.end || t);
    const leadIdx = Math.max(0, Math.min(Math.floor(progress), leadN) - 1);
    const li = Math.max(0, Math.min(g.n - 1, lap - 1));
    return {
      driverNumber: ghost.scenario.driverNumber,
      lap,
      lapFraction: frac0,
      progress,
      position,
      gapToLeader: position === 1 ? 0 : Math.max(0, tHere - (leadIdx >= 0 && Number.isFinite(lead[leadIdx]) ? lead[leadIdx] : 0) - (progress - Math.floor(progress)) * 0),
      gapAhead: bestAhead ? Math.max(0, tHere - timeAtProgress(bestAhead, Math.min(progress, bestAhead.n))) : Infinity,
      compound: g.n ? g.compound[li] : 'MEDIUM',
      tyreAge: g.n ? g.age[li] : 0,
      inPit: !finished && (pit || (g.pitIn[li] === 1 && frac0 > 1 - PIT_WINDOW) || (li > 0 && g.pitIn[li - 1] === 1 && frac0 < PIT_WINDOW)),
      retired: false,
      finished,
    };
  }

  function leaderLapAt(t: number): number {
    if (t <= 0) return 1;
    return Math.min(totalLaps, upperBound(lead, leadN, t) + 1);
  }

  function timeAtLap(lap: number): number {
    if (lap <= 1 || leadN === 0) return 0;
    return lead[Math.min(lap - 2, leadN - 1)];
  }

  function trackStatusAt(t: number): TrackStatusType | null {
    const lap = leaderLapAt(t);
    let found: TrackStatusType | null = null;
    for (const s of bundle.trackStatus) {
      if (lap >= s.startLap && lap <= s.endLap) {
        if (s.type === 'RED') return 'RED';
        if (s.type === 'SC' || !found) found = s.type;
      }
    }
    return found;
  }

  return {
    bundle,
    totalLaps,
    duration,
    cumulative,
    statesAt,
    progressAt,
    progressForLaps,
    ghostProgressAt,
    ghostStateAt,
    leaderLapAt,
    timeAtLap,
    trackStatusAt,
  };
}
