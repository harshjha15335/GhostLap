import { CLEAR_D, CLEAR_S } from './dims';
import { sampleLane, type LaneTrack } from './laneTrack';

/**
 * Collision-free placement of the replay field (visual only — race order and gaps always
 * come from the timeline).
 *
 * Every car has a TRUE arc position (from the timeline) and a VISUAL one
 * `sv = sTrue + e` with a hold-back `e ≤ 0`, plus a lateral offset `d` from the centre line.
 * Each step (race-time sub-steps of ≤ 0.25 s):
 *
 *  1. `e` relaxes back to 0 (cars catch up with reality at R units/s).
 *  2. Lateral targets: the racing line by default. A car that reality says is about to
 *     pass (true gap < 15 % of a car length and closing, or already ahead) pulls into a
 *     passing lane beside the car in front — the inside of the next corner, or the side
 *     with more room on a straight — and stays there while the two are overlapping.
 *     Lateral motion is rate-limited per metre travelled (eased, never a jump) and kept
 *     inside the asphalt (+ kerb allowance).
 *  3. A car alongside another that reality has behind yields (drops back) until it is a
 *     full car length behind, so the pass completes; the passer then rejoins the line.
 *  4. A longitudinal sweep guarantees that no two footprints overlap: a car overlapping
 *     laterally with one in front is held back to one car length + clearance.
 *
 * Under SC / VSC / red (`noPass`) nobody attacks: the field runs single file with
 * car-length spacing. Pit-lane cars keep their pit offset; obstacles (crashing cars)
 * are fixed and avoided. A seek (large or negative dt) re-solves statically.
 * No allocations per step.
 */
export const KIND_OFF = 0;
export const KIND_RACE = 1;
export const KIND_PIT = 2;
export const KIND_OBSTACLE = 3;

export interface TrafficInput {
  /** true arc position, 0..L (render units) */
  sTrue: Float64Array;
  kind: Uint8Array;
  /** preferred lateral offset; NaN = racing line (obstacles: their fixed offset) */
  prefD: Float32Array;
  /** neutralised (SC / VSC / red): no overtaking, single file */
  noPass: boolean;
}

const RELAX = 1.0; // units/s a held-back car regains on reality
const YIELD = 0.8; // extra units/s a passed car drops back
export const SLOPE = 0.25; // max lateral change per unit travelled (racing)
export const SLOPE_PIT = 0.4;
export const MIN_LAT = 0.35; // units/s lateral even when (nearly) stationary
const KAPPA_MIN = 0.03;
const ATTACK = 0.15 * CLEAR_S;
const GIVE_UP = 0.35 * CLEAR_S;
const SUB_DT = 0.25;
export const MAX_STEP_DT = 8;

export class TrafficResolver {
  readonly n: number;
  readonly lt: LaneTrack;
  /** visual arc position (0..L) and lateral offset per car */
  readonly sv: Float64Array;
  readonly d: Float32Array;
  /** heading offset from lateral motion (rad, + = turning right of the track tangent) */
  readonly yaw: Float32Array;
  /** 1 while side-by-side with another car */
  readonly alongside: Uint8Array;
  /** 1 while a racing car is still outside the asphalt (rejoining from the pit lane / grass) */
  readonly merging: Uint8Array;
  /** true when the last step re-solved from scratch (seek) */
  resetLast = true;

  private readonly e: Float64Array;
  private readonly sT: Float64Array;
  private readonly prevTrue: Float64Array;
  private readonly vel: Float64Array;
  private readonly travel: Float64Array;
  private readonly netTravel: Float64Array;
  private readonly subStart: Float64Array;
  private readonly side: Int8Array;
  private readonly pairWith: Int16Array;
  private readonly lastKind: Uint8Array;
  private readonly dNext: Float32Array;
  private readonly dOld: Float32Array;
  private readonly frameD: Float32Array;
  private readonly frameS: Float64Array;
  private readonly ord: Int32Array;
  private readonly rot: Int32Array;
  private nOrd = 0;
  private init = false;
  private input: TrafficInput | null = null;

  constructor(lt: LaneTrack, n: number) {
    this.lt = lt;
    this.n = n;
    this.sv = new Float64Array(n);
    this.d = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.alongside = new Uint8Array(n);
    this.merging = new Uint8Array(n);
    this.e = new Float64Array(n);
    this.sT = new Float64Array(n);
    this.prevTrue = new Float64Array(n);
    this.vel = new Float64Array(n);
    this.travel = new Float64Array(n);
    this.netTravel = new Float64Array(n);
    this.subStart = new Float64Array(n);
    this.side = new Int8Array(n);
    this.pairWith = new Int16Array(n).fill(-1);
    this.lastKind = new Uint8Array(n);
    this.dNext = new Float32Array(n);
    this.dOld = new Float32Array(n);
    this.frameD = new Float32Array(n);
    this.frameS = new Float64Array(n);
    this.ord = new Int32Array(n);
    this.rot = new Int32Array(n);
  }

  reset() {
    this.init = false;
  }

  private wrapS(x: number) {
    const L = this.lt.length;
    return ((x % L) + L) % L;
  }

  /** signed shortest arc distance from a to b (b ahead → positive) */
  diff(a: number, b: number) {
    const L = this.lt.length;
    let x = (b - a) % L;
    if (x > L / 2) x -= L;
    else if (x <= -L / 2) x += L;
    return x;
  }

  private pref(i: number) {
    const p = this.input!.prefD[i];
    return Number.isNaN(p) ? sampleLane(this.lt.line, this.lt, this.sv[i]) : p;
  }

  private outside(i: number) {
    const v = this.d[i];
    return v < sampleLane(this.lt.lo, this.lt, this.sv[i]) - 0.02 || v > sampleLane(this.lt.hi, this.lt, this.sv[i]) + 0.02;
  }

  private clampTrack(i: number, v: number) {
    const lo = sampleLane(this.lt.lo, this.lt, this.sv[i]);
    const hi = sampleLane(this.lt.hi, this.lt, this.sv[i]);
    return v < lo ? lo : v > hi ? hi : v;
  }

  step(input: TrafficInput, dt: number) {
    this.input = input;
    const n = this.n;
    this.frameD.set(this.d);
    this.frameS.set(this.sv);
    if (!this.init || !(dt >= 0) || dt > MAX_STEP_DT) {
      this.staticSolve();
      this.resetLast = true;
    } else {
      this.resetLast = false;
      // cars that (re)appear start at reality on their preferred line
      for (let i = 0; i < n; i++) {
        const k = input.kind[i];
        if (k !== KIND_OFF && this.lastKind[i] === KIND_OFF) {
          this.e[i] = 0;
          this.prevTrue[i] = input.sTrue[i];
          this.sv[i] = input.sTrue[i];
          this.d[i] = k === KIND_RACE ? this.clampTrack(i, this.pref(i)) : this.pref(i);
          this.frameD[i] = this.d[i];
          this.frameS[i] = this.sv[i];
          this.side[i] = 0;
          this.pairWith[i] = -1;
          this.merging[i] = 0;
        } else if (k === KIND_RACE && this.lastKind[i] !== KIND_RACE) this.merging[i] = 1;
      }
      const nSub = dt > 0 ? Math.min(32, Math.max(1, Math.ceil(dt / SUB_DT))) : 1;
      const h = dt / nSub;
      for (let s = 1; s <= nSub; s++) {
        const w = s / nSub;
        for (let i = 0; i < n; i++) {
          if (input.kind[i] === KIND_OFF) continue;
          const dd = this.diff(this.prevTrue[i], input.sTrue[i]);
          this.sT[i] = this.wrapS(this.prevTrue[i] + dd * w);
          this.vel[i] = dt > 0 ? dd / dt : 0;
        }
        this.substep(h);
      }
    }
    for (let i = 0; i < n; i++) {
      this.prevTrue[i] = input.sTrue[i];
      this.lastKind[i] = input.kind[i];
    }
    this.finishFrame(dt);
  }

  private staticSolve() {
    const inp = this.input!;
    for (let i = 0; i < this.n; i++) {
      this.e[i] = 0;
      this.side[i] = 0;
      this.pairWith[i] = -1;
      this.yaw[i] = 0;
      this.merging[i] = 0;
      if (inp.kind[i] === KIND_OFF) continue;
      this.sT[i] = inp.sTrue[i];
      this.sv[i] = inp.sTrue[i];
      this.vel[i] = 0;
      const k = inp.kind[i];
      this.d[i] = k === KIND_RACE ? this.clampTrack(i, this.pref(i)) : this.pref(i);
      this.frameD[i] = this.d[i];
      this.frameS[i] = this.sv[i];
    }
    this.settle();
    this.init = true;
  }

  /** active cars sorted front → back, starting behind the biggest gap on the lap */
  private buildOrder() {
    const inp = this.input!;
    const ord = this.ord;
    let m = 0;
    for (let i = 0; i < this.n; i++) if (inp.kind[i] !== KIND_OFF) ord[m++] = i;
    // insertion sort, descending sv, ties: truly-ahead first
    for (let a = 1; a < m; a++) {
      const v = ord[a];
      let b = a - 1;
      while (b >= 0 && (this.sv[ord[b]] < this.sv[v] || (this.sv[ord[b]] === this.sv[v] && this.sT[ord[b]] < this.sT[v]))) {
        ord[b + 1] = ord[b];
        b--;
      }
      ord[b + 1] = v;
    }
    let start = 0;
    let best = -1;
    const L = this.lt.length;
    for (let k = 0; k < m; k++) {
      const gap = k === 0 ? this.sv[ord[m - 1]] + L - this.sv[ord[0]] : this.sv[ord[k - 1]] - this.sv[ord[k]];
      if (gap > best) {
        best = gap;
        start = k;
      }
    }
    for (let k = 0; k < m; k++) this.rot[k] = ord[(start + k) % m];
    this.nOrd = m;
  }

  private substep(h: number) {
    const inp = this.input!;
    const n = this.n;
    const kind = inp.kind;
    // 1. visual positions + relax hold-back
    for (let i = 0; i < n; i++) {
      const k = kind[i];
      if (k === KIND_OFF) continue;
      if (k === KIND_OBSTACLE) {
        // fixed pose; a hold-back it picked up (sliding into a car ahead) is kept
        this.sv[i] = this.wrapS(this.sT[i] + this.e[i]);
        this.d[i] = inp.prefD[i];
        continue;
      }
      const before = this.sv[i];
      this.subStart[i] = before;
      this.e[i] = Math.min(0, this.e[i] + RELAX * h);
      this.sv[i] = this.wrapS(this.sT[i] + this.e[i]);
      // lateral allowance follows the car's VISUAL progress (a held-back car moves less)
      this.travel[i] = Math.min(Math.abs(this.diff(before, this.sv[i])), this.netTravel[i] * 1.15 + 0.02);
    }
    this.buildOrder();
    const m = this.nOrd;
    const rot = this.rot;

    // 2. lateral targets + rate-limited moves
    this.dOld.set(this.d);
    for (let a = 0; a < m; a++) {
      const i = rot[a];
      const k = kind[i];
      if (k === KIND_OBSTACLE) {
        this.dNext[i] = this.d[i];
        continue;
      }
      const travel = this.travel[i];
      const pref = this.pref(i);
      if (k === KIND_PIT) {
        const st = SLOPE_PIT * travel + 4 * MIN_LAT * h;
        this.dNext[i] = this.d[i] + Math.max(-st, Math.min(st, pref - this.d[i]));
        this.side[i] = 0;
        this.pairWith[i] = -1;
        continue;
      }
      // nearest racing car / obstacle visually ahead
      let j = -1;
      let dj = Infinity;
      for (let b = 0; b < m; b++) {
        const o = rot[b];
        if (o === i || kind[o] === KIND_PIT) continue;
        const dl = this.diff(this.sv[i], this.sv[o]);
        if (dl >= 0 && dl < 2 * CLEAR_S && dl < dj) {
          dj = dl;
          j = o;
        }
      }
      let intent = false;
      if (j >= 0) {
        if (kind[j] === KIND_OBSTACLE) intent = Math.abs(pref - this.d[j]) < CLEAR_D + 0.2 || Math.abs(this.d[i] - this.d[j]) < CLEAR_D;
        else if (!inp.noPass) {
          const tg = this.diff(this.sT[i], this.sT[j]);
          const closing = this.vel[i] > this.vel[j] + 1e-4;
          const latched = this.side[i] !== 0 && this.pairWith[i] === j;
          intent = (tg < ATTACK && (closing || tg < 0)) || (latched && tg < GIVE_UP);
        }
      }
      let target = pref;
      if (intent) {
        if (this.side[i] === 0 || this.pairWith[i] !== j) {
          const rel = this.d[i] - this.d[j];
          let sg = 0;
          if (Math.abs(rel) > 0.35) sg = Math.sign(rel);
          else {
            let kBest = 0;
            for (let x = 0; x <= 16; x += 0.8) {
              const kk = sampleLane(this.lt.kappa, this.lt, this.sv[i] + x);
              if (Math.abs(kk) > Math.abs(kBest)) kBest = kk;
            }
            if (Math.abs(kBest) > KAPPA_MIN) sg = kBest > 0 ? 1 : -1;
            else {
              const lo = sampleLane(this.lt.lo, this.lt, this.sv[i]);
              const hi = sampleLane(this.lt.hi, this.lt, this.sv[i]);
              sg = hi - this.d[j] >= this.d[j] - lo ? 1 : -1;
            }
          }
          // no room on that side → the other one
          const lo = sampleLane(this.lt.lo, this.lt, this.sv[i]);
          const hi = sampleLane(this.lt.hi, this.lt, this.sv[i]);
          if (sg > 0 && this.d[j] + CLEAR_D > hi && this.d[j] - CLEAR_D >= lo) sg = -1;
          else if (sg < 0 && this.d[j] - CLEAR_D < lo && this.d[j] + CLEAR_D <= hi) sg = 1;
          this.side[i] = sg as -1 | 1;
          this.pairWith[i] = j;
        }
        target = this.d[j] + this.side[i] * CLEAR_D * 1.04;
      } else {
        this.side[i] = 0;
        this.pairWith[i] = -1;
      }
      // steer around a stopped / spinning car close by (in front or beside)
      for (let b = 0; b < m; b++) {
        const o = rot[b];
        if (kind[o] !== KIND_OBSTACLE) continue;
        const dl = this.diff(this.sv[i], this.sv[o]);
        if (dl <= -CLEAR_S * 1.2 || dl >= 2.5 * CLEAR_S) continue;
        if (Math.abs(target - this.d[o]) >= CLEAR_D * 1.05) continue;
        let sg = Math.sign(this.d[i] - this.d[o]);
        if (sg === 0) sg = this.d[o] > 0 ? -1 : 1;
        target = this.d[o] + sg * CLEAR_D * 1.05;
        const t2 = this.clampTrack(i, target);
        if (Math.abs(t2 - this.d[o]) < CLEAR_D) target = this.d[o] - sg * CLEAR_D * 1.05;
      }
      // stay on your side of anyone you are already alongside
      for (let b = 0; b < m; b++) {
        const o = rot[b];
        if (o === i) continue;
        if (Math.abs(this.diff(this.sv[i], this.sv[o])) >= CLEAR_S) continue;
        const rel = this.d[i] - this.d[o];
        if (Math.abs(rel) >= CLEAR_D - 1e-3) target = rel > 0 ? Math.max(target, this.d[o] + CLEAR_D) : Math.min(target, this.d[o] - CLEAR_D);
      }
      target = this.clampTrack(i, target);
      if (this.merging[i] && this.outside(i)) {
        // rejoining from the pit lane: glide onto the asphalt at pit-lane rate
        const st = SLOPE_PIT * travel + 4 * MIN_LAT * h;
        this.dNext[i] = this.d[i] + Math.max(-st, Math.min(st, target - this.d[i]));
        continue;
      }
      this.merging[i] = 0;
      const st = SLOPE * travel + MIN_LAT * h;
      this.dNext[i] = this.clampTrack(i, this.d[i] + Math.max(-st, Math.min(st, target - this.d[i])));
    }

    // 3. keep alongside pairs separated (bounds narrowing / both moving)
    for (let a = 0; a < m; a++) {
      const i = rot[a];
      for (let b = a + 1; b < m; b++) {
        const o = rot[b];
        if (Math.abs(this.diff(this.sv[i], this.sv[o])) >= CLEAR_S) continue;
        const rel0 = this.dOld[i] - this.dOld[o];
        if (Math.abs(rel0) < CLEAR_D - 1e-3) continue;
        const rel = this.dNext[i] - this.dNext[o];
        if (Math.abs(rel) >= CLEAR_D && Math.sign(rel) === Math.sign(rel0)) continue;
        const sg = Math.sign(rel0);
        const fixI = kind[i] !== KIND_RACE || this.merging[i] === 1;
        const fixO = kind[o] !== KIND_RACE || this.merging[o] === 1;
        if (fixI && fixO) continue;
        // first cancel whatever moved towards the other car (keeps the rate limit) …
        if (!fixI && sg * (this.dNext[i] - this.dOld[i]) < 0) this.dNext[i] = this.clampTrack(i, this.dOld[i]);
        if (!fixO && sg * (this.dNext[o] - this.dOld[o]) > 0) this.dNext[o] = this.clampTrack(o, this.dOld[o]);
        const deficit = CLEAR_D - sg * (this.dNext[i] - this.dNext[o]);
        if (deficit <= 0) continue;
        // … then push apart what the narrowing asphalt still squeezes
        let mi = fixI ? 0 : fixO ? deficit : deficit / 2;
        let mo = fixO ? 0 : deficit - mi;
        const ni = fixI ? this.dNext[i] : this.clampTrack(i, this.dNext[i] + sg * mi);
        mi = Math.abs(ni - this.dNext[i]);
        mo = deficit - mi;
        if (!fixO) this.dNext[o] = this.clampTrack(o, this.dNext[o] - sg * mo);
        this.dNext[i] = ni;
      }
    }
    for (let a = 0; a < m; a++) this.d[rot[a]] = this.dNext[rot[a]];

    // 4. the car reality has behind yields to the one beside it
    for (let a = 0; a < m; a++) {
      const i = rot[a];
      if (kind[i] !== KIND_RACE) continue;
      for (let b = 0; b < m; b++) {
        const o = rot[b];
        if (o === i || kind[o] !== KIND_RACE) continue;
        const dl = this.diff(this.sv[i], this.sv[o]); // o ahead → positive
        if (dl <= -CLEAR_S || dl >= CLEAR_S) continue;
        if (Math.abs(this.d[i] - this.d[o]) < CLEAR_D - 1e-3) continue;
        const tg = this.diff(this.sT[i], this.sT[o]);
        if (tg <= 0) continue; // i is truly ahead
        if (this.side[i] !== 0 && this.pairWith[i] === o && tg < GIVE_UP) continue; // attacking
        const need = CLEAR_S - dl;
        const back = Math.min(need, (RELAX + YIELD) * h);
        this.e[i] -= back;
        this.sv[i] = this.wrapS(this.sT[i] + this.e[i]);
      }
    }

    // 5. stay on the asphalt where the cars ended up + the hard no-overlap guarantee
    this.settle();
    for (let i = 0; i < n; i++) if (kind[i] === KIND_RACE || kind[i] === KIND_PIT) this.netTravel[i] = Math.abs(this.diff(this.subStart[i], this.sv[i]));
  }

  private settle() {
    const kind = this.input!.kind;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.n; i++) if (kind[i] === KIND_RACE && !this.merging[i]) this.d[i] = this.clampTrack(i, this.d[i]);
      this.sweep();
    }
  }

  /** hold back any car that overlaps (laterally) with one in front of it */
  private sweep() {
    const inp = this.input!;
    const kind = inp.kind;
    for (let iter = 0; iter < 8; iter++) {
      this.buildOrder();
      const m = this.nOrd;
      const rot = this.rot;
      let pushed = false;
      for (let a = 1; a < m; a++) {
        const i = rot[a];
        for (let b = a - 1; b >= 0; b--) {
          const j = rot[b];
          const dl = this.diff(this.sv[i], this.sv[j]);
          if (dl >= CLEAR_S - 1e-6) {
            if (dl > 2 * CLEAR_S) break;
            continue;
          }
          if (dl <= -CLEAR_S) continue;
          if (Math.abs(this.d[i] - this.d[j]) >= CLEAR_D - 1e-4) continue;
          if (dl < 0) {
            // order changed by an earlier push this pass: re-sort and look again
            pushed = true;
            continue;
          }
          // i is behind (or level with) j: hold i back (a sliding obstacle too — it stops short)
          this.e[i] -= CLEAR_S - dl;
          this.sv[i] = this.wrapS(this.sT[i] + this.e[i]);
          pushed = true;
        }
      }
      if (!pushed) break;
    }
  }

  private finishFrame(dt: number) {
    const inp = this.input!;
    for (let i = 0; i < this.n; i++) {
      this.alongside[i] = 0;
      if (inp.kind[i] === KIND_OFF) continue;
      const travel = Math.abs(this.diff(this.frameS[i], this.sv[i]));
      const dd = this.d[i] - this.frameD[i];
      const target = this.resetLast ? 0 : Math.max(-0.45, Math.min(0.45, Math.atan2(dd, Math.max(travel, 0.06))));
      const k = this.resetLast ? 1 : Math.min(1, travel / 1.2 + dt * 0.5);
      this.yaw[i] += (target - this.yaw[i]) * k;
    }
    for (let i = 0; i < this.n; i++) {
      if (inp.kind[i] !== KIND_RACE) continue;
      for (let o = i + 1; o < this.n; o++) {
        if (inp.kind[o] === KIND_OFF) continue;
        if (Math.abs(this.diff(this.sv[i], this.sv[o])) < CLEAR_S && Math.abs(this.d[i] - this.d[o]) >= CLEAR_D - 1e-3) {
          this.alongside[i] = 1;
          this.alongside[o] = 1;
        }
      }
    }
  }
}

/** Footprint overlap check used by the tests (and handy for debugging). */
export function overlaps(r: TrafficResolver, kind: Uint8Array, eps = 1e-3): [number, number] | null {
  for (let i = 0; i < r.n; i++) {
    if (kind[i] === KIND_OFF) continue;
    for (let j = i + 1; j < r.n; j++) {
      if (kind[j] === KIND_OFF) continue;
      if (kind[i] === KIND_OBSTACLE && kind[j] === KIND_OBSTACLE) continue;
      if (Math.abs(r.diff(r.sv[i], r.sv[j])) < CLEAR_S - eps && Math.abs(r.d[i] - r.d[j]) < CLEAR_D - eps) return [i, j];
    }
  }
  return null;
}
