import type { CarRace, CarState, Compound, GhostResult, RaceBundle, TrackStatusType } from '@/types';

/**
 * Lap-time driven race interpolator (Phase 0 starter — Agent 1 owns and refines).
 *
 * t = 0 is the race start. A car's position on track is derived from its
 * cumulative lap times, with sector times giving a piecewise-linear speed profile
 * inside each lap mapped onto the circuit's sector split fractions.
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
  statesAt(t: number): CarState[];
  progressAt(driverNumber: number, t: number): LapProgress;
  /** lap progress for an arbitrary lap-time series (used for the ghost car) */
  progressForLaps(cumulative: number[], sectors: [number, number, number][] | null, t: number): LapProgress;
  ghostProgressAt(ghost: GhostResult, t: number): LapProgress;
  /** leader's lap at time t (1-based) */
  leaderLapAt(t: number): number;
  /** time at which the leader starts the given lap */
  timeAtLap(lap: number): number;
  trackStatusAt(t: number): TrackStatusType | null;
}

function cumsum(xs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const x of xs) out.push((acc += x));
  return out;
}

function upperBound(arr: number[], t: number): number {
  // first index with arr[i] > t
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function compoundAt(car: CarRace, lap: number): { compound: Compound; age: number } {
  const s = car.stints.find((st) => lap >= st.lapStart && lap <= st.lapEnd) ?? car.stints[car.stints.length - 1];
  if (!s) return { compound: 'MEDIUM', age: lap };
  return { compound: s.compound, age: s.tyreAgeAtStart + (lap - s.lapStart) };
}

export function createRaceTimeline(bundle: RaceBundle): RaceTimeline {
  const { circuit, totalLaps } = bundle;
  const [split1, split2] = circuit.sectorSplits;
  const cumulative = new Map<number, number[]>();
  const carsByNum = new Map<number, CarRace>();
  for (const car of bundle.cars) {
    cumulative.set(car.driverNumber, cumsum(car.laps));
    carsByNum.set(car.driverNumber, car);
  }
  const leader = bundle.cars.find((c) => c.finishPosition === 1) ?? bundle.cars[0];
  const leaderCum = cumulative.get(leader.driverNumber) ?? [0];
  const lastFlag = Math.max(...bundle.cars.map((c) => (c.status === 'FINISHED' ? (cumulative.get(c.driverNumber)?.at(-1) ?? 0) : 0)));
  const duration = (Number.isFinite(lastFlag) && lastFlag > 0 ? lastFlag : leaderCum.at(-1) ?? 0) + 5;

  function fractionInLap(elapsed: number, lapTime: number, sectors: [number, number, number] | null): number {
    if (lapTime <= 0) return 0;
    if (!sectors) return Math.min(1, elapsed / lapTime);
    const [s1, s2] = sectors;
    if (elapsed < s1) return (elapsed / s1) * split1;
    if (elapsed < s1 + s2) return split1 + ((elapsed - s1) / s2) * (split2 - split1);
    const s3 = Math.max(1e-3, lapTime - s1 - s2);
    return Math.min(1, split2 + ((elapsed - s1 - s2) / s3) * (1 - split2));
  }

  function progressForLaps(cum: number[], sectors: [number, number, number][] | null, t: number): LapProgress {
    if (cum.length === 0) return { lap: 1, lapFraction: 0, progress: 0, finished: false };
    if (t <= 0) return { lap: 1, lapFraction: 0, progress: 0, finished: false };
    const i = upperBound(cum, t); // laps completed
    if (i >= cum.length) {
      return { lap: cum.length, lapFraction: 1, progress: cum.length, finished: cum.length >= totalLaps };
    }
    const lapStart = i === 0 ? 0 : cum[i - 1];
    const lapTime = cum[i] - lapStart;
    const f = fractionInLap(t - lapStart, lapTime, sectors ? sectors[i] ?? null : null);
    return { lap: i + 1, lapFraction: f, progress: i + f, finished: false };
  }

  function progressAt(dn: number, t: number): LapProgress {
    const car = carsByNum.get(dn);
    const cum = cumulative.get(dn);
    if (!car || !cum) return { lap: 1, lapFraction: 0, progress: 0, finished: false };
    return progressForLaps(cum, car.sectors, t);
  }

  function timeAtProgress(cum: number[], progress: number): number {
    const lapIdx = Math.floor(progress);
    if (lapIdx >= cum.length) return cum.at(-1) ?? 0;
    const start = lapIdx === 0 ? 0 : cum[lapIdx - 1];
    return start + (cum[lapIdx] - start) * (progress - lapIdx);
  }

  function statesAt(t: number): CarState[] {
    const raw = bundle.cars.map((car) => {
      const cum = cumulative.get(car.driverNumber)!;
      const p = progressForLaps(cum, car.sectors, t);
      const retired = car.status !== 'FINISHED' && t > (cum.at(-1) ?? 0);
      const pitLaps = new Set(car.pits.map((x) => x.lap));
      const inPit =
        !retired &&
        ((pitLaps.has(p.lap) && p.lapFraction > 0.93) || (pitLaps.has(p.lap - 1) && p.lapFraction < 0.07));
      const { compound, age } = compoundAt(car, p.lap);
      return { car, cum, p, retired, inPit, compound, age };
    });
    // running order: finished cars by finish position, then by progress, retired last
    raw.sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      if (a.p.finished && b.p.finished) return (a.car.finishPosition ?? 99) - (b.car.finishPosition ?? 99);
      if (a.p.finished !== b.p.finished) return a.p.finished ? -1 : 1;
      return b.p.progress - a.p.progress;
    });
    const leaderRaw = raw[0];
    return raw.map((r, idx) => {
      const ahead = idx > 0 ? raw[idx - 1] : null;
      const tHere = timeAtProgress(r.cum, r.p.progress);
      const gapTo = (other: typeof r | null) =>
        other ? Math.max(0, tHere - timeAtProgress(other.cum, Math.min(r.p.progress, other.cum.length))) : Infinity;
      return {
        driverNumber: r.car.driverNumber,
        lap: r.p.lap,
        lapFraction: r.p.lapFraction,
        progress: r.p.progress,
        position: idx + 1,
        gapToLeader: idx === 0 ? 0 : gapTo(leaderRaw),
        gapAhead: gapTo(ahead),
        compound: r.compound,
        tyreAge: r.age,
        inPit: r.inPit,
        retired: r.retired,
        finished: r.p.finished,
      } satisfies CarState;
    });
  }

  function leaderLapAt(t: number): number {
    return Math.min(totalLaps, upperBound(leaderCum, t) + 1);
  }

  function timeAtLap(lap: number): number {
    if (lap <= 1) return 0;
    return leaderCum[Math.min(lap - 2, leaderCum.length - 1)] ?? 0;
  }

  function trackStatusAt(t: number): TrackStatusType | null {
    const lap = leaderLapAt(t);
    const w = bundle.trackStatus.find((s) => lap >= s.startLap && lap <= s.endLap);
    return w ? w.type : null;
  }

  return {
    bundle,
    totalLaps,
    duration,
    cumulative,
    statesAt,
    progressAt,
    progressForLaps,
    ghostProgressAt: (ghost, t) => progressForLaps(ghost.cumulative, null, t),
    leaderLapAt,
    timeAtLap,
    trackStatusAt,
  };
}
