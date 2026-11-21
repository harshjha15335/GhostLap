import type {
  Compound,
  GhostOvertake,
  GhostResult,
  RaceBundle,
  WhatIfPreset,
  WhatIfScenario,
  WhatIfStop,
} from '@/types';
import {
  addStopCost,
  compress,
  DRY,
  gapAheadAt,
  getRaceModel,
  PIT_IN_SHARE,
  stopCost,
  tyreDelta,
  type CarModel,
  type RaceModel,
} from './raceModel';

/**
 * Deterministic "What If?" Ghost Car solver.
 *
 *   LapTime_ghost(L) = BasePace_D(L) + Δtyre(compound, age) + Δfuel(L)
 *                      + ΔdirtyAir(gap_ahead) + Δpit(L) + ΔSC(L)
 *
 * Delta method: the driver's real lap already contains BasePace_D(L) plus the
 * real strategy's tyre / fuel / dirty-air / pit / SC terms (and real-world noise),
 * so for every lap L ≥ fromLap
 *
 *   ghost(L) = real(L) + [model(ghost strategy, L) − model(real strategy, L)]
 *
 * which reproduces the real race exactly for an unchanged scenario.
 *  - Δtyre  = offset_c + deg_c·age + cliff (fitted per race, see raceModel.ts);
 *             0 on SC/VSC/RED laps (the pace is neutralised there)
 *  - Δfuel  = fuelSecondsPerLap·(T − L), identical for both strategies → cancels
 *  - ΔdirtyAir = dirtyAirMaxPenalty when the gap to the car ahead at the line
 *             is ≤ 1.0 s, linear to 0 at 2.0 s, vs the REAL field's crossings
 *  - Δpit   = pitLoss (× 0.6 under SC/VSC, 0 under red), split 40 % in-lap /
 *             60 % out-lap; a ghost stop on the same lap as a real one costs
 *             exactly what the real one did (slow stops stay slow)
 *  - ΔSC    = SC / red-flag field compression: the ghost's time gained or lost
 *             before the neutralisation is mapped through the real field's
 *             gap-before → gap-after curve at the restart
 * The field never reacts to the ghost.
 */
export const MODEL = {
  fuelSecondsPerLap: 0.03,
  dirtyAirMaxPenalty: 0.3,
  dirtyAirFullGap: 1.0,
  dirtyAirZeroGap: 2.0,
  safetyCarPitDiscount: 0.4,
  minPitDelta: -8,
  maxPitDelta: 12,
  pitInLapShare: PIT_IN_SHARE,
  /** drive-through ≈ one pit loss; stop-and-go adds this stationary time when unstated */
  stopGoSeconds: 10,
} as const;

/** Extra per-lap detail for the UI (all arrays indexed lap-1). */
export interface GhostResultEx extends GhostResult {
  compoundByLap: Compound[];
  tyreAgeByLap: number[];
  /** gap to the car ahead at the start of each lap (real field), Infinity if none */
  gapAheadByLap: number[];
  /** laps on which the ghost entered the pit lane */
  pitLaps: number[];
  /** real driver's running position at the end of each lap */
  realPositionByLap: number[];
}

/** Dirty-air lap-time penalty (s) for a gap (s) to the car ahead. */
export function dirtyAirPenalty(gapAheadSeconds: number): number {
  return MODEL.dirtyAirMaxPenalty * downforceLoss(gapAheadSeconds);
}

/** Fraction (0..1) of the dirty-air effect for the UI's downforce bar: 1 at ≤ 1.0 s, 0 at ≥ 2.0 s. */
export function downforceLoss(gapAheadSeconds: number): number {
  if (!Number.isFinite(gapAheadSeconds) || gapAheadSeconds >= MODEL.dirtyAirZeroGap) return 0;
  if (gapAheadSeconds <= MODEL.dirtyAirFullGap) return 1;
  return (MODEL.dirtyAirZeroGap - gapAheadSeconds) / (MODEL.dirtyAirZeroGap - MODEL.dirtyAirFullGap);
}

function carOf(m: RaceModel, dn: number): CarModel {
  return m.cars.get(dn) ?? m.order[0];
}

/** Real tyre-change stops at or after fromLap, with the compound fitted on. */
export function realStops(bundle: RaceBundle, driverNumber: number, fromLap = 1): WhatIfStop[] {
  const car = bundle.cars.find((c) => c.driverNumber === driverNumber) ?? bundle.cars[0];
  return car.stints
    .slice(1)
    .map((s) => ({ lap: s.lapStart - 1, compound: s.compound }))
    .filter((s) => s.lap >= fromLap);
}

export function defaultScenario(bundle: RaceBundle, driverNumber: number, fromLap: number): WhatIfScenario {
  const car = bundle.cars.find((c) => c.driverNumber === driverNumber) ?? bundle.cars[0];
  const L0 = Math.max(1, Math.min(Math.round(fromLap) || 1, Math.max(1, car.laps.length)));
  return { driverNumber: car.driverNumber, fromLap: L0, stops: realStops(bundle, car.driverNumber, L0), avoidPenalties: false };
}

interface PenaltyPlan {
  /** seconds removed from given laps' pit cost */
  removeAtLap: Map<number, number>;
  /** seconds removed from the classification time (post-race penalties) */
  postRace: number;
  /** pit visits (non-tyre) that disappear entirely */
  dropVisit: Set<number>;
  /** TIME penalties whose serving stop the ghost no longer makes: lap awarded, seconds */
  moved: { lap: number; seconds: number; servedAt: number }[];
}

function planPenalties(m: RaceModel, cm: CarModel, scenario: WhatIfScenario): PenaltyPlan {
  const plan: PenaltyPlan = { removeAtLap: new Map(), postRace: 0, dropVisit: new Set(), moved: [] };
  const dn = cm.car.driverNumber;
  for (const p of m.penalties) {
    if (p.driverNumber !== dn) continue;
    if (p.category === 'TIME') {
      const secs = p.seconds ?? 0;
      if (p.servedLap == null) {
        if (scenario.avoidPenalties) plan.postRace += Math.min(secs, cm.postRaceSeconds + 0.5);
        continue;
      }
      const stop = [...cm.stops].reverse().find((s) => s.tyres && s.lap <= p.servedLap! && s.lap >= Math.max(p.lap, p.servedLap! - 4));
      if (!stop) continue;
      if (scenario.avoidPenalties) plan.removeAtLap.set(stop.lap, (plan.removeAtLap.get(stop.lap) ?? 0) + secs);
      else plan.moved.push({ lap: p.lap, seconds: secs, servedAt: stop.lap });
    } else if (scenario.avoidPenalties) {
      const lo = p.servedLap != null ? p.servedLap - 4 : p.lap;
      const hi = p.servedLap ?? cm.n;
      const visit = cm.stops.find((s) => !s.tyres && s.lap >= Math.max(lo, p.lap) && s.lap <= hi && !plan.dropVisit.has(s.lap));
      if (visit) plan.dropVisit.add(visit.lap);
      else plan.postRace += m.pitLoss + (p.category === 'STOP_GO' ? (p.seconds ?? MODEL.stopGoSeconds) : 0);
    }
  }
  return plan;
}

interface GhostStop {
  lap: number;
  compound: Compound;
  ageAtStart: number;
  cost: number;
}

function buildGhostStops(m: RaceModel, cm: CarModel, scenario: WhatIfScenario, plan: PenaltyPlan): GhostStop[] {
  const { car, n } = cm;
  const fromLap = scenario.fromLap;
  const out: GhostStop[] = [];
  const realByLap = new Map(cm.stops.map((s) => [s.lap, s]));
  // real tyre stops before fromLap stay
  for (let i = 1; i < car.stints.length; i++) {
    const s = car.stints[i];
    const lap = s.lapStart - 1;
    if (lap >= fromLap) continue;
    const rs = realByLap.get(lap);
    out.push({ lap, compound: s.compound, ageAtStart: s.tyreAgeAtStart, cost: rs ? rs.cost : stopCost(m, lap, null, MODEL.safetyCarPitDiscount) });
  }
  // the ghost's own stops: reuse the real tyre set (age) of the same compound, in order
  const pool = car.stints.slice(1).filter((s) => s.lapStart - 1 >= fromLap);
  const usedPool = new Set<number>();
  const seen = new Set<number>(out.map((s) => s.lap));
  const sorted = [...scenario.stops].filter((s) => s.lap >= fromLap && s.lap >= 1 && s.lap < n).sort((a, b) => a.lap - b.lap);
  // the j-th ghost stop inherits the j-th real stop's lane time (slow stop, penalty served there)
  const realAfter = cm.stops.filter((s) => s.tyres && s.lap >= fromLap);
  const own: GhostStop[] = [];
  const inherited: (number | null)[] = [];
  for (const st of sorted) {
    if (seen.has(st.lap)) continue;
    seen.add(st.lap);
    let age = 0;
    const k = pool.findIndex((s, i) => !usedPool.has(i) && s.compound === st.compound);
    if (k >= 0) {
      usedPool.add(k);
      age = pool[k].tyreAgeAtStart;
    }
    const rs = realAfter[own.length];
    let cost: number;
    if (rs && rs.lap === st.lap) cost = rs.cost;
    else {
      const freeRed = rs ? rs.laneSeconds > 3 * m.medianLane || !!m.redLap[rs.lap - 1] : true;
      cost = stopCost(m, st.lap, freeRed ? null : rs.laneSeconds, MODEL.safetyCarPitDiscount);
    }
    inherited.push(rs ? rs.lap : null);
    own.push({ lap: st.lap, compound: st.compound, ageAtStart: age, cost });
  }
  // penalty seconds
  own.forEach((s, j) => {
    const from = inherited[j];
    const rm = from != null ? plan.removeAtLap.get(from) : undefined;
    if (rm) s.cost = Math.max(0, s.cost - rm);
  });
  for (const s of out) {
    const rm = plan.removeAtLap.get(s.lap);
    if (rm) s.cost = Math.max(0, s.cost - rm);
  }
  for (const mv of plan.moved) {
    if (mv.servedAt < fromLap || inherited.includes(mv.servedAt)) continue; // still served
    const next = [...own].reverse().find((s) => s.lap >= mv.lap && !m.redLap[s.lap - 1]);
    if (next) next.cost += mv.seconds;
    else plan.postRace -= mv.seconds; // added to the race time after the flag instead
  }
  out.push(...own);
  out.sort((a, b) => a.lap - b.lap);
  return out;
}

function sameStops(a: WhatIfStop[], b: WhatIfStop[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p.lap - q.lap);
  const y = [...b].sort((p, q) => p.lap - q.lap);
  return x.every((s, i) => s.lap === y[i].lap && s.compound === y[i].compound);
}

const MINUS = '−';
function fmtDelta(d: number): string {
  const v = Math.abs(d) < 0.005 ? 0 : d;
  return `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(2)}s`;
}

function describeKind(m: RaceModel, real: WhatIfStop[], ghost: WhatIfStop[], avoid: boolean): string {
  const neutral = (lap: number) => m.status[lap - 1] === 'SC' || m.status[lap - 1] === 'VSC';
  const realLaps = new Set(real.map((s) => s.lap));
  if (ghost.some((s) => !realLaps.has(s.lap) && neutral(s.lap))) {
    return ghost.some((s) => !realLaps.has(s.lap) && m.status[s.lap - 1] === 'SC') ? 'Safety Car stop' : 'VSC stop';
  }
  if (ghost.length > real.length) return 'Extra stop';
  if (ghost.length < real.length) return ghost.length === 1 ? 'One-stop gamble' : 'Fewer stops';
  const r = [...real].sort((a, b) => a.lap - b.lap);
  const g = [...ghost].sort((a, b) => a.lap - b.lap);
  for (let i = 0; i < g.length; i++) {
    if (g[i].lap < r[i].lap) return 'Undercut';
    if (g[i].lap > r[i].lap) return 'Overcut';
    if (g[i].compound !== r[i].compound) return 'Compound switch';
  }
  return avoid ? 'Clean race' : 'Same strategy';
}

export function simulateGhost(bundle: RaceBundle, scenario: WhatIfScenario): GhostResultEx {
  const m = getRaceModel(bundle);
  const cm = carOf(m, scenario.driverNumber);
  const { car, n } = cm;
  const dn = car.driverNumber;
  const fromLap = Math.max(1, Math.min(Math.round(scenario.fromLap) || 1, Math.max(1, n)));
  const sc: WhatIfScenario = { ...scenario, driverNumber: dn, fromLap };

  const plan = planPenalties(m, cm, sc);
  const gStops = buildGhostStops(m, cm, sc, plan);

  // ghost pit cost per lap: tyre stops + real non-tyre visits (unless dropped)
  const gPit = new Float64Array(n);
  for (const s of gStops) addStopCost(gPit, s.lap, s.cost, PIT_IN_SHARE);
  for (const v of cm.stops) if (!v.tyres && !plan.dropVisit.has(v.lap)) addStopCost(gPit, v.lap, v.cost, PIT_IN_SHARE);
  const pitLaps = [...new Set([...gStops.map((s) => s.lap), ...cm.stops.filter((v) => !v.tyres && !plan.dropVisit.has(v.lap)).map((v) => v.lap)])].sort((a, b) => a - b);

  // ghost tyre timeline
  const gComp: Compound[] = new Array(n);
  const gAge: number[] = new Array(n);
  const first = car.stints[0];
  let c: Compound = first?.compound ?? 'MEDIUM';
  let a0 = first ? first.tyreAgeAtStart : 0;
  let startLap = 1;
  let k = 0;
  for (let L = 1; L <= n; L++) {
    while (k < gStops.length && gStops[k].lap < L) {
      c = gStops[k].compound;
      a0 = gStops[k].ageAtStart;
      startLap = gStops[k].lap + 1;
      k++;
    }
    gComp[L - 1] = c;
    gAge[L - 1] = a0 + (L - startLap);
  }

  const laps = new Array<number>(n);
  const cumulative = new Array<number>(n);
  const gapAheadByLap = new Array<number>(n).fill(Infinity);
  const spanEnd = new Map(m.spans.map((s) => [s.end, s]));
  let acc = 0;
  for (let L = 1; L <= n; L++) {
    const i = L - 1;
    const real = car.laps[i];
    let t = real;
    const green = !m.status[i];
    if (L >= 2) gapAheadByLap[i] = gapAheadAt(m, acc, dn);
    if (L >= fromLap) {
      if (green) {
        t += tyreDelta(m.fit, gComp[i], gAge[i]) - tyreDelta(m.fit, cm.compound[i], cm.age[i]);
        if (L >= 2) {
          const gReal = gapAheadAt(m, cm.cum[i - 1], dn);
          t += dirtyAirPenalty(gapAheadByLap[i]) - dirtyAirPenalty(gReal);
        }
      }
      t += gPit[i] - cm.pitCost[i];
      const span = spanEnd.get(L);
      if (span && span.start - 1 >= fromLap - 1 && span.start >= 2) {
        // compress the ghost's pre-neutralisation gain/loss like the real field's gaps
        const S1 = span.start - 2; // index of lap S-1
        const before = cumulative[S1] - cm.cum[S1];
        if (Math.abs(before) > 1e-9) {
          const gD = cm.cum[S1] - m.lead[S1];
          const after = compress(span, gD + before) - compress(span, gD);
          t += after - before;
        }
      }
      t = Math.max(t, 0.5 * real);
    }
    laps[i] = t;
    acc += t;
    cumulative[i] = acc;
  }
  const totalTime = acc;
  const realTotalTime = n ? cm.cum[n - 1] : 0;

  // classification
  const ghostKey = cm.key + (totalTime - realTotalTime) - plan.postRace;
  let ahead = 0;
  for (const o of m.order) if (o !== cm && o.key < ghostKey) ahead++;
  const ghostFinishPosition = ahead + 1;
  const positionsGained = cm.rank - ghostFinishPosition;

  // running order per lap, overtakes vs the real field
  const others = m.order.filter((o) => o !== cm);
  const positionByLap = new Array<number>(n);
  const realPositionByLap = new Array<number>(n);
  const overtakes: GhostOvertake[] = [];
  const prevG = new Int8Array(others.length);
  const prevR = new Int8Array(others.length);
  for (let L = 1; L <= n; L++) {
    const i = L - 1;
    let pg = 1;
    let pr = 1;
    for (let j = 0; j < others.length; j++) {
      const o = others[j];
      const has = o.n >= L;
      const gAhead = has && o.cum[i] < cumulative[i] ? 1 : 0;
      const rAhead = has && o.cum[i] < cm.cum[i] ? 1 : 0;
      pg += gAhead;
      pr += rAhead;
      if (L >= 2 && L >= fromLap && has && gAhead !== prevG[j]) {
        const realFlipSame = rAhead !== prevR[j] && rAhead === gAhead;
        if (!realFlipSame) overtakes.push({ lap: L, driverNumber: o.car.driverNumber, gained: gAhead === 0 });
      }
      prevG[j] = gAhead;
      prevR[j] = rAhead;
    }
    positionByLap[i] = pg;
    realPositionByLap[i] = pr;
  }
  if (n) {
    positionByLap[n - 1] = ghostFinishPosition;
    realPositionByLap[n - 1] = cm.rank;
  }

  const deltaSeconds = totalTime - realTotalTime - plan.postRace;
  const real = realStops(bundle, dn, fromLap);
  const unchanged = sameStops(real, sc.stops.filter((s) => s.lap >= fromLap)) && !sc.avoidPenalties;
  let verdict: string;
  if (unchanged && Math.abs(deltaSeconds) < 0.005) verdict = 'No change from the real race.';
  else {
    const kind = describeKind(m, real, sc.stops, sc.avoidPenalties);
    const outcome = positionsGained > 0 || (positionsGained === 0 && deltaSeconds < -0.5) ? 'works' : positionsGained < 0 || deltaSeconds > 0.5 ? 'fails' : 'is a wash';
    verdict = `${kind} ${outcome}: P${cm.rank} → P${ghostFinishPosition} (${fmtDelta(deltaSeconds)})`;
  }

  return {
    scenario: sc,
    laps,
    cumulative,
    totalTime,
    realTotalTime,
    deltaSeconds,
    realFinishPosition: car.finishPosition,
    ghostFinishPosition,
    positionsGained,
    positionByLap,
    overtakes,
    verdict,
    compoundByLap: gComp,
    tyreAgeByLap: gAge,
    gapAheadByLap,
    pitLaps,
    realPositionByLap,
  };
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const PLURAL: Record<Compound, string> = { SOFT: 'Softs', MEDIUM: 'Mediums', HARD: 'Hards', INTERMEDIATE: 'Inters', WET: 'Wets' };

interface Candidate {
  scenario: WhatIfScenario;
  result: GhostResultEx;
  label: string;
  description: string;
  score: number;
}

function onTrackGain(m: RaceModel, r: GhostResultEx): boolean {
  const pits = new Set(r.pitLaps);
  return r.overtakes.some((o) => {
    if (!o.gained || pits.has(o.lap) || pits.has(o.lap - 1) || m.status[o.lap - 1]) return false;
    const other = m.cars.get(o.driverNumber);
    return !!other && !other.stops.some((s) => s.lap === o.lap || s.lap === o.lap - 1);
  });
}

function score(m: RaceModel, r: GhostResultEx): number {
  return r.positionsGained * 10 + (onTrackGain(m, r) ? 4 : 0) - r.deltaSeconds * 0.3;
}

function legal(m: RaceModel, cm: CarModel, r: GhostResultEx): boolean {
  if (m.wet || cm.usedDry.size < 2) return true;
  return new Set(r.compoundByLap.filter((c) => DRY.includes(c))).size >= 2;
}

function candidates(m: RaceModel): CarModel[] {
  const top = m.order.filter((o) => o.car.status === 'FINISHED' && o.n === m.totalLaps && o.rank <= 10);
  return top.length >= 3 ? top : m.order.filter((o) => o.car.status === 'FINISHED').slice(0, 12);
}

function compoundOptions(m: RaceModel, real: Compound): Compound[] {
  if (real === 'INTERMEDIATE' || real === 'WET') return [real];
  const opts: Compound[] = [real];
  for (const c of ['HARD', 'MEDIUM', 'SOFT'] as Compound[]) if (c !== real && !m.wet) opts.push(c);
  return opts;
}

function consider(m: RaceModel, cm: CarModel, scenario: WhatIfScenario, label: string, description: string, best: Candidate | null): Candidate | null {
  const result = simulateGhost(m.bundle, scenario);
  if (!legal(m, cm, result)) return best;
  const s = score(m, result);
  if (!best || s > best.score + 1e-9) return { scenario, result, label, description, score: s };
  return best;
}

function searchUndercut(m: RaceModel): Candidate | null {
  let best: Candidate | null = null;
  for (const cm of candidates(m)) {
    const dn = cm.car.driverNumber;
    const stops = realStops(m.bundle, dn, 1);
    stops.forEach((st, idx) => {
      if (m.redLap[st.lap - 1]) return;
      const prevLap = idx > 0 ? stops[idx - 1].lap : 0;
      for (let shift = 1; shift <= 5; shift++) {
        const lap = st.lap - shift;
        if (lap < prevLap + 3 || lap < 2 || m.status[lap - 1]) continue;
        for (const c of [st.compound]) {
          const ghostStops = stops.filter((_, j) => j >= idx).map((s, j) => (j === 0 ? { lap, compound: c } : s));
          const scenario: WhatIfScenario = { driverNumber: dn, fromLap: lap, stops: ghostStops, avoidPenalties: false };
          const label = `Undercut ${shift} Lap${shift > 1 ? 's' : ''} Earlier on ${PLURAL[c]}`;
          const description = `Car ${dn} boxes on lap ${lap} instead of ${st.lap} for ${PLURAL[c].toLowerCase()}.`;
          best = consider(m, cm, scenario, label, description, best);
        }
      }
    });
  }
  return best;
}

function searchSafetyCar(m: RaceModel, exclude: number | null): Candidate | null {
  let best: Candidate | null = null;
  const windows = m.bundle.trackStatus.filter((w) => (w.type === 'SC' || w.type === 'VSC') && w.startLap >= 2 && w.startLap < m.totalLaps - 1);
  for (const w of windows) {
    const S = w.startLap;
    const label = w.type === 'SC' ? 'Box Under Safety Car' : 'Box Under the VSC';
    for (const cm of candidates(m)) {
      const dn = cm.car.driverNumber;
      if (dn === exclude) continue;
      if (cm.stops.some((s) => s.tyres && s.lap >= S && s.lap <= w.endLap)) continue; // already boxed there
      const stops = realStops(m.bundle, dn, 1);
      const remaining = m.totalLaps - S;
      const trial = (ghostAll: WhatIfStop[], fromLap: number, desc: string) => {
        const scenario: WhatIfScenario = { driverNumber: dn, fromLap, stops: ghostAll.filter((s) => s.lap >= fromLap), avoidPenalties: false };
        best = consider(m, cm, scenario, label, desc, best);
      };
      // move the next stop forward into the window
      const nextIdx = stops.findIndex((s) => s.lap > w.endLap);
      if (nextIdx >= 0) {
        for (const c of compoundOptions(m, stops[nextIdx].compound)) {
          const g = stops.map((s, j) => (j === nextIdx ? { lap: S, compound: c } : s));
          trial(g, Math.min(S, stops[nextIdx].lap), `Car ${dn} pits under the ${w.type} on lap ${S} (was lap ${stops[nextIdx].lap}) for ${PLURAL[c].toLowerCase()}.`);
        }
      }
      // delay the previous stop into the window
      const prevIdx = (() => {
        for (let j = stops.length - 1; j >= 0; j--) if (stops[j].lap < S) return j;
        return -1;
      })();
      if (prevIdx >= 0 && S - stops[prevIdx].lap <= 8) {
        const g = stops.map((s, j) => (j === prevIdx ? { lap: S, compound: s.compound } : s));
        trial(g, stops[prevIdx].lap, `Car ${dn} stays out until the ${w.type} and pits on lap ${S} (was lap ${stops[prevIdx].lap}).`);
      }
      // an extra stop under the neutralisation
      if (remaining >= 4) {
        const opts: Compound[] = m.wet ? [cm.compound[S - 1]] : remaining <= 20 ? ['SOFT', 'MEDIUM'] : remaining <= 35 ? ['MEDIUM', 'HARD'] : ['HARD'];
        for (const c of opts) {
          const g = [...stops, { lap: S, compound: c }].sort((a, b) => a.lap - b.lap);
          trial(g, S, `Car ${dn} takes a free-ish extra stop under the ${w.type} on lap ${S} for ${PLURAL[c].toLowerCase()}.`);
        }
      }
    }
  }
  return best;
}

function searchAlternative(m: RaceModel, exclude: number | null): Candidate | null {
  let best: Candidate | null = null;
  for (const cm of candidates(m)) {
    const dn = cm.car.driverNumber;
    if (dn === exclude) continue;
    const stops = realStops(m.bundle, dn, 1);
    stops.forEach((st, idx) => {
      if (m.status[st.lap - 1]) return;
      const nextLap = idx + 1 < stops.length ? stops[idx + 1].lap : cm.n;
      for (let shift = 3; shift <= 8; shift++) {
        const lap = st.lap + shift;
        if (lap > nextLap - 3 || lap >= cm.n - 1 || m.status[lap - 1]) continue;
        const g = stops.map((s, j) => (j === idx ? { lap, compound: s.compound } : s));
        best = consider(m, cm, { driverNumber: dn, fromLap: st.lap, stops: g.filter((s) => s.lap >= st.lap), avoidPenalties: false },
          `Extend Stint +${shift} Laps`, `Car ${dn} stays out ${shift} laps longer and pits on lap ${lap} instead of ${st.lap}.`, best);
      }
    });
    if (stops.length >= 2) {
      for (let drop = 0; drop < stops.length; drop++) {
        const g = stops.filter((_, j) => j !== drop);
        const fromLap = stops[drop].lap;
        best = consider(m, cm, { driverNumber: dn, fromLap, stops: g.filter((s) => s.lap >= fromLap), avoidPenalties: false },
          g.length === 1 ? 'One-Stop Gamble' : 'Skip a Stop', `Car ${dn} skips the lap-${stops[drop].lap} stop and runs to the end.`, best);
      }
    }
  }
  return best;
}

const presetCache = new WeakMap<RaceBundle, WhatIfPreset[]>();

function toPreset(id: string, c: Candidate): WhatIfPreset {
  return {
    id,
    label: c.label,
    description: `${c.description} ${c.result.verdict}`,
    scenario: c.scenario,
    expected: {
      positionsGained: c.result.positionsGained,
      deltaSeconds: c.result.deltaSeconds,
      ghostFinishPosition: c.result.ghostFinishPosition,
      realFinishPosition: c.result.realFinishPosition,
    },
  };
}

const good = (c: Candidate | null) => !!c && (c.result.positionsGained > 0 || c.result.deltaSeconds < -0.5);

/**
 * Two one-tap presets: an undercut, and "Box Under Safety Car" when the race had
 * an SC/VSC (else / if that never helps, an overcut or a one-stop gamble).
 * Deterministic search over top-10 finishers and stop timings, picking the most
 * dramatic positive outcome (places gained, on-track ghost passes, time).
 */
export function computePresets(bundle: RaceBundle): WhatIfPreset[] {
  const hit = presetCache.get(bundle);
  if (hit) return hit;
  const m = getRaceModel(bundle);
  const out: WhatIfPreset[] = [];
  const under = searchUndercut(m);
  if (under) out.push(toPreset('undercut', under));
  const ex = under ? under.scenario.driverNumber : null;
  const scCand = searchSafetyCar(m, ex);
  let second: Candidate | null = scCand;
  if (!good(scCand)) {
    const alt = searchAlternative(m, ex);
    if (alt && (!scCand || good(alt) || alt.score > scCand.score)) second = alt;
  }
  if (second) out.push(toPreset(second === scCand ? 'safety-car' : 'alternative', second));
  presetCache.set(bundle, out);
  return out;
}
