import type { CarRace, Compound, RaceBundle, TrackStatusType } from '@/types';

/**
 * Per-race model fitted from the real bundle (cached per bundle object).
 * Shared by the strategy simulator and its tests. Pure, deterministic.
 */

export const FUEL_SECONDS_PER_LAP = 0.03;

export const DEFAULT_DEG: Record<Compound, number> = {
  SOFT: 0.09,
  MEDIUM: 0.06,
  HARD: 0.035,
  INTERMEDIATE: 0.05,
  WET: 0.04,
};
/** fresh-tyre pace offset vs MEDIUM (s/lap); wet compounds are not compared with slicks */
export const DEFAULT_OFFSET: Record<Compound, number> = {
  SOFT: -0.5,
  MEDIUM: 0,
  HARD: 0.4,
  INTERMEDIATE: 0,
  WET: 0,
};
/** tyre age after which a mild quadratic "cliff" kicks in */
export const CLIFF_AGE: Record<Compound, number> = {
  SOFT: 22,
  MEDIUM: 32,
  HARD: 45,
  INTERMEDIATE: 30,
  WET: 35,
};
export const CLIFF_SECONDS = 0.015; // s per lap² beyond the cliff age

export const DRY: Compound[] = ['SOFT', 'MEDIUM', 'HARD'];

/** penalty list written by scripts/fetch_2026_season.py (optional bundle extension) */
export interface BundlePenalty {
  driverNumber: number;
  lap: number;
  category: 'TIME' | 'DRIVE_THROUGH' | 'STOP_GO';
  seconds: number | null;
  /** lap the penalty was served on track; null = added to the race time after the flag */
  servedLap: number | null;
}
export type RaceBundleExt = RaceBundle & { penalties?: BundlePenalty[] };

export interface TyreFit {
  deg: Record<Compound, number>;
  offset: Record<Compound, number>;
  /** clean laps used per compound (0 → defaults) */
  samples: Record<Compound, number>;
  /** age where the cliff starts: max(CLIFF_AGE, oldest age seen in this race + 3) */
  cliff: Record<Compound, number>;
}

export interface StopInfo {
  lap: number;
  /** tyre change (stint boundary) vs pit-lane visit without a tyre change */
  tyres: boolean;
  /** total modelled time cost of this visit, seconds */
  cost: number;
  laneSeconds: number;
}

export interface CarModel {
  car: CarRace;
  n: number;
  cum: Float64Array;
  compound: Compound[];
  /** tyre age per lap (index L-1) */
  age: Int32Array;
  stops: StopInfo[];
  /** modelled pit cost carried by each lap (index L-1) */
  pitCost: Float64Array;
  /** classification sort key (monotone in official order) */
  key: number;
  /** 1-based rank in the official/derived classification */
  rank: number;
  /** seconds added to the lap sum by penalties applied after the flag (from raceTime) */
  postRaceSeconds: number;
  usedDry: Set<Compound>;
}

export interface NeutralSpan {
  start: number;
  end: number;
  /** compression map knots: gap to leader before → after the neutralisation */
  gb: number[];
  ga: number[];
}

export interface RaceModel {
  bundle: RaceBundleExt;
  totalLaps: number;
  fit: TyreFit;
  /** per lap (index L-1): neutralised type, or null when green */
  status: (TrackStatusType | null)[];
  redLap: Uint8Array;
  spans: NeutralSpan[];
  medianLane: number;
  pitLoss: number;
  cars: Map<number, CarModel>;
  order: CarModel[];
  /** leader's end-of-lap time per lap (min over the field) */
  lead: Float64Array;
  /** every line crossing of every car, sorted; owner driver numbers alongside */
  crossT: Float64Array;
  crossD: Int32Array;
  penalties: BundlePenalty[];
  wet: boolean;
}

const cache = new WeakMap<RaceBundle, RaceModel>();

function median(xs: number[], dflt: number): number {
  if (!xs.length) return dflt;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function tyreDelta(fit: TyreFit, c: Compound, age: number): number {
  let d = fit.offset[c] + fit.deg[c] * age;
  const over = age - fit.cliff[c];
  if (over > 0) d += CLIFF_SECONDS * over * over;
  return d;
}

function lapStatus(bundle: RaceBundle): (TrackStatusType | null)[] {
  const st: (TrackStatusType | null)[] = new Array(bundle.totalLaps).fill(null);
  const rank: Record<TrackStatusType, number> = { VSC: 1, SC: 2, RED: 3 };
  for (const w of bundle.trackStatus) {
    for (let L = Math.max(1, w.startLap); L <= Math.min(bundle.totalLaps, w.endLap); L++) {
      const cur = st[L - 1];
      if (!cur || rank[w.type] > rank[cur]) st[L - 1] = w.type;
    }
  }
  return st;
}

/** Penalties: bundle.penalties when present, else parsed from PENALTY events (service unknown). */
function penaltiesOf(bundle: RaceBundleExt): BundlePenalty[] {
  if (bundle.penalties) return bundle.penalties;
  const out: BundlePenalty[] = [];
  for (const e of bundle.events) {
    if (e.type !== 'PENALTY' || e.driverNumber == null) continue;
    const msg = e.message.toUpperCase();
    const t = /(\d+) SECOND TIME PENALTY/.exec(msg);
    if (t) out.push({ driverNumber: e.driverNumber, lap: e.lap, category: 'TIME', seconds: +t[1], servedLap: null });
    else if (/DRIVE[- ]THROUGH/.test(msg))
      out.push({ driverNumber: e.driverNumber, lap: e.lap, category: 'DRIVE_THROUGH', seconds: null, servedLap: null });
    else if (/STOP[- ]AND[- ]GO/.test(msg))
      out.push({ driverNumber: e.driverNumber, lap: e.lap, category: 'STOP_GO', seconds: null, servedLap: null });
  }
  return out;
}

/** Real compound / age per lap from the stints. */
export function tyreTimeline(car: CarRace): { compound: Compound[]; age: Int32Array } {
  const n = car.laps.length;
  const compound: Compound[] = new Array(n);
  const age = new Int32Array(n);
  const st = car.stints;
  let k = 0;
  for (let L = 1; L <= n; L++) {
    while (k < st.length - 1 && L > st[k].lapEnd) k++;
    const s = st[k];
    if (!s) {
      compound[L - 1] = 'MEDIUM';
      age[L - 1] = L - 1;
      continue;
    }
    compound[L - 1] = s.compound;
    age[L - 1] = Math.max(0, s.tyreAgeAtStart + (L - s.lapStart));
  }
  return { compound, age };
}

/** Modelled time cost of a pit-lane visit on lap `lap`. */
export function stopCost(
  m: Pick<RaceModel, 'status' | 'redLap' | 'pitLoss' | 'medianLane'>,
  lap: number,
  laneSeconds: number | null,
  discount: number,
): number {
  const i = lap - 1;
  if (m.redLap[i] || (laneSeconds != null && laneSeconds > 3 * m.medianLane)) return 0; // free change under red
  const nominal = m.pitLoss * (m.status[i] === 'SC' || m.status[i] === 'VSC' ? 1 - discount : 1);
  const extra = laneSeconds == null ? 0 : Math.max(-3, Math.min(15, laneSeconds - m.medianLane));
  return Math.max(0, nominal + extra);
}

/** Spread a stop's cost over in-lap (share) and out-lap (rest). */
export function addStopCost(arr: Float64Array, lap: number, cost: number, inShare: number): void {
  const n = arr.length;
  if (lap < 1 || lap > n) return;
  if (lap === n) {
    arr[lap - 1] += cost;
    return;
  }
  arr[lap - 1] += cost * inShare;
  arr[lap] += cost * (1 - inShare);
}

export const PIT_IN_SHARE = 0.4;
export const SC_PIT_DISCOUNT = 0.4;

function fitTyres(bundle: RaceBundle, status: (TrackStatusType | null)[]): TyreFit {
  const T = bundle.totalLaps;
  const sxy: Record<Compound, number> = { SOFT: 0, MEDIUM: 0, HARD: 0, INTERMEDIATE: 0, WET: 0 };
  const sxx: Record<Compound, number> = { SOFT: 0, MEDIUM: 0, HARD: 0, INTERMEDIATE: 0, WET: 0 };
  const cnt: Record<Compound, number> = { SOFT: 0, MEDIUM: 0, HARD: 0, INTERMEDIATE: 0, WET: 0 };
  type StintSample = { c: Compound; ages: number[]; ys: number[] };
  const perCar: StintSample[][] = [];
  for (const car of bundle.cars) {
    const n = car.laps.length;
    if (n < 8) continue;
    const pitLaps = new Set<number>();
    for (const p of car.pits) {
      pitLaps.add(p.lap);
      pitLaps.add(p.lap + 1);
    }
    const green: number[] = [];
    for (let L = 2; L <= n; L++) if (!status[L - 1] && !status[L - 2] && !pitLaps.has(L)) green.push(car.laps[L - 1]);
    const med = median(green, 0);
    if (!med) continue;
    const samples: StintSample[] = [];
    for (const s of car.stints) {
      const ages: number[] = [];
      const ys: number[] = [];
      const raw: number[] = [];
      for (let L = Math.max(2, s.lapStart); L <= Math.min(n, s.lapEnd); L++) {
        if (status[L - 1] || status[L - 2] || pitLaps.has(L)) continue;
        const t = car.laps[L - 1];
        if (t > med * 1.07) continue;
        raw.push(t);
        ages.push(s.tyreAgeAtStart + (L - s.lapStart));
        ys.push(t - FUEL_SECONDS_PER_LAP * (T - L));
      }
      if (ages.length < 5) continue;
      // trim traffic/mistake laps: > 1.5 s off the stint's median (fuel-corrected)
      const ym = median(ys, 0);
      const keep = ys.map((y) => Math.abs(y - ym) < 1.5);
      const a = ages.filter((_, i) => keep[i]);
      const y = ys.filter((_, i) => keep[i]);
      if (a.length < 5) continue;
      samples.push({ c: s.compound, ages: a, ys: y });
      const ma = a.reduce((p, q) => p + q, 0) / a.length;
      const my = y.reduce((p, q) => p + q, 0) / y.length;
      for (let i = 0; i < a.length; i++) {
        sxy[s.compound] += (a[i] - ma) * (y[i] - my);
        sxx[s.compound] += (a[i] - ma) * (a[i] - ma);
      }
      cnt[s.compound] += a.length;
    }
    perCar.push(samples);
  }
  const deg = { ...DEFAULT_DEG };
  const PRIOR_LAPS = 40;
  for (const c of Object.keys(deg) as Compound[]) {
    if (cnt[c] < 10 || sxx[c] <= 0) continue;
    const k = sxy[c] / sxx[c];
    const shrunk = (k * cnt[c] + DEFAULT_DEG[c] * PRIOR_LAPS) / (cnt[c] + PRIOR_LAPS);
    deg[c] = Math.min(0.25, Math.max(0.01, shrunk));
  }
  // compound offsets vs MEDIUM from drivers who ran both (deg-corrected stint means)
  const offset = { ...DEFAULT_OFFSET };
  for (const c of ['SOFT', 'HARD'] as Compound[]) {
    const diffs: number[] = [];
    for (const samples of perCar) {
      const mean = (cc: Compound) => {
        const v: number[] = [];
        for (const s of samples)
          if (s.c === cc) for (let i = 0; i < s.ages.length; i++) v.push(s.ys[i] - deg[cc] * s.ages[i]);
        return v.length >= 5 ? v.reduce((p, q) => p + q, 0) / v.length : null;
      };
      const a = mean(c);
      const b = mean('MEDIUM');
      if (a != null && b != null) diffs.push(a - b);
    }
    if (diffs.length) {
      const fitted = median(diffs, DEFAULT_OFFSET[c]);
      const v = (fitted * diffs.length + DEFAULT_OFFSET[c] * 3) / (diffs.length + 3);
      // physical ordering: softer is faster when fresh (track evolution must not invert it)
      offset[c] = c === 'SOFT' ? Math.min(-0.1, Math.max(-1.5, v)) : Math.min(1.5, Math.max(0.1, v));
    }
  }
  // the real field shows no cliff up to the oldest tyres it actually ran
  const cliff = { ...CLIFF_AGE };
  for (const car of bundle.cars)
    for (const s of car.stints) {
      const oldest = s.tyreAgeAtStart + (Math.min(s.lapEnd, car.laps.length) - s.lapStart);
      cliff[s.compound] = Math.max(cliff[s.compound], oldest + 3);
    }
  // …and softer compounds degrade at least as fast as harder ones
  deg.MEDIUM = Math.max(deg.MEDIUM, deg.HARD);
  deg.SOFT = Math.max(deg.SOFT, deg.MEDIUM);
  return { deg, offset, samples: cnt, cliff };
}

export function getRaceModel(bundle: RaceBundle): RaceModel {
  const hit = cache.get(bundle);
  if (hit) return hit;
  const b = bundle as RaceBundleExt;
  const T = bundle.totalLaps;
  const status = lapStatus(bundle);
  const redLap = new Uint8Array(T + 1);
  status.forEach((s, i) => {
    if (s === 'RED') redLap[i] = 1;
  });
  const lanes: number[] = [];
  for (const c of bundle.cars) for (const p of c.pits) if (p.laneSeconds > 0 && p.laneSeconds < 60) lanes.push(p.laneSeconds);
  const medianLane = median(lanes, 23);
  const pitLoss = bundle.pitLossSeconds > 5 && bundle.pitLossSeconds < 45 ? bundle.pitLossSeconds : Math.max(15, medianLane - 2);
  const fit = fitTyres(bundle, status);
  const base = { status, redLap, pitLoss, medianLane };

  const cars = new Map<number, CarModel>();
  for (const car of bundle.cars) {
    const n = car.laps.length;
    const cum = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) cum[i] = acc += car.laps[i];
    const { compound, age } = tyreTimeline(car);
    const changeLaps = new Set(car.stints.slice(1).map((s) => s.lapStart - 1));
    const stops: StopInfo[] = [];
    const pitCost = new Float64Array(n);
    const seen = new Set<number>();
    for (const p of car.pits) {
      if (p.lap < 1 || p.lap > n || seen.has(p.lap)) continue;
      seen.add(p.lap);
      const cost = stopCost(base, p.lap, p.laneSeconds, SC_PIT_DISCOUNT);
      stops.push({ lap: p.lap, tyres: changeLaps.has(p.lap), cost, laneSeconds: p.laneSeconds });
      addStopCost(pitCost, p.lap, cost, PIT_IN_SHARE);
    }
    // a tyre change without a pit record (defensive): nominal cost
    for (const L of changeLaps) {
      if (seen.has(L) || L < 1 || L > n) continue;
      const cost = stopCost(base, L, null, SC_PIT_DISCOUNT);
      stops.push({ lap: L, tyres: true, cost, laneSeconds: medianLane });
      addStopCost(pitCost, L, cost, PIT_IN_SHARE);
    }
    stops.sort((a, c) => a.lap - c.lap);
    const usedDry = new Set<Compound>(compound.filter((c) => DRY.includes(c)));
    const postRace = car.raceTime != null && n ? Math.max(0, car.raceTime - acc) : 0;
    cars.set(car.driverNumber, {
      car,
      n,
      cum,
      compound,
      age,
      stops,
      pitCost,
      key: 0,
      rank: 0,
      postRaceSeconds: postRace,
      usedDry,
    });
  }

  // classification order: classified by position, then the rest by laps desc / time asc
  const all = [...cars.values()];
  const classified = all.filter((m) => m.car.finishPosition != null).sort((a, c) => a.car.finishPosition! - c.car.finishPosition!);
  const rest = all
    .filter((m) => m.car.finishPosition == null)
    .sort((a, c) => c.n - a.n || (a.n ? a.cum[a.n - 1] : 0) - (c.n ? c.cum[c.n - 1] : 0) || a.car.driverNumber - c.car.driverNumber);
  const order = [...classified, ...rest];
  let prev = -Infinity;
  order.forEach((m, i) => {
    const time = m.n ? (m.car.raceTime ?? m.cum[m.n - 1]) : 0;
    let key = (T - m.n) * 1e5 + time;
    if (key <= prev) key = prev + 1e-3;
    m.key = prev = key;
    m.rank = i + 1;
  });

  const lead = new Float64Array(T);
  lead.fill(Infinity);
  for (const m of all) for (let i = 0; i < Math.min(m.n, T); i++) if (m.cum[i] < lead[i]) lead[i] = m.cum[i];

  let total = 0;
  for (const m of all) total += m.n;
  const pairs: [number, number][] = [];
  for (const m of all) for (let i = 0; i < m.n; i++) pairs.push([m.cum[i], m.car.driverNumber]);
  pairs.sort((a, c) => a[0] - c[0]);
  const crossT = new Float64Array(total);
  const crossD = new Int32Array(total);
  pairs.forEach(([t, d], i) => {
    crossT[i] = t;
    crossD[i] = d;
  });

  // SC / RED neutralisation spans (VSC keeps gaps, so it does not compress)
  const spans: NeutralSpan[] = [];
  for (let L = 1; L <= T; L++) {
    const s = status[L - 1];
    if (s !== 'SC' && s !== 'RED') continue;
    let E = L;
    while (E < T && (status[E] === 'SC' || status[E] === 'RED')) E++;
    if (L >= 2) {
      const S = L;
      const typical = median(
        all.filter((m) => m.n >= S - 1).map((m) => (S - 1 >= 1 ? m.car.laps[S - 2] : 0)),
        90,
      );
      const knots: [number, number][] = [[0, 0]];
      for (const m of all) {
        if (m.n < E) continue;
        if (m.stops.some((p) => p.lap >= S - 1 && p.lap <= E)) continue;
        const gb = m.cum[S - 2] - lead[S - 2];
        const ga = m.cum[E - 1] - lead[E - 1];
        if (gb < 0 || gb > 1.5 * typical) continue;
        knots.push([gb, ga]);
      }
      knots.sort((a, c) => a[0] - c[0]);
      const gb: number[] = [];
      const ga: number[] = [];
      let run = 0;
      for (const [x, y] of knots) {
        run = Math.max(run, y);
        if (gb.length && x - gb[gb.length - 1] < 1e-6) {
          ga[ga.length - 1] = run;
          continue;
        }
        gb.push(x);
        ga.push(run);
      }
      if (gb.length >= 3) spans.push({ start: S, end: E, gb, ga });
    }
    L = E;
  }

  const model: RaceModel = {
    bundle: b,
    totalLaps: T,
    fit,
    status,
    redLap,
    spans,
    medianLane,
    pitLoss,
    cars,
    order,
    lead,
    crossT,
    crossD,
    penalties: penaltiesOf(b),
    wet: all.some((m) => m.compound.some((c) => c === 'INTERMEDIATE' || c === 'WET')),
  };
  cache.set(bundle, model);
  return model;
}

/** Compression map of a neutralisation span: gap-to-leader before → after. */
export function compress(span: NeutralSpan, g: number): number {
  const { gb, ga } = span;
  if (g <= gb[0]) return ga[0] + (g - gb[0]);
  const last = gb.length - 1;
  if (g >= gb[last]) return ga[last] + 0.5 * (g - gb[last]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (gb[mid] <= g) lo = mid;
    else hi = mid;
  }
  const f = (g - gb[lo]) / (gb[hi] - gb[lo]);
  return ga[lo] + f * (ga[hi] - ga[lo]);
}

/** Time gap (s) from a line crossing at `t` back to the nearest earlier crossing by any other car. */
export function gapAheadAt(m: RaceModel, t: number, self: number): number {
  const { crossT, crossD } = m;
  let lo = 0;
  let hi = crossT.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (crossT[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    if (crossD[i] === self) continue;
    return t - crossT[i];
  }
  return Infinity;
}
