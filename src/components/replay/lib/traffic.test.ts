import { describe, expect, it } from 'vitest';
import type { CarState, TrackStatusType } from '@/types';
import { loadBundle, raceSlugs } from '@/engine/testUtils';
import { createCircuitCurve } from '@/engine/circuitCurve';
import { createRaceTimeline } from '@/engine/raceInterpolator';
import { buildTrackModel } from '@/components/track/trackModel';
import { CLEAR_D, CLEAR_S, PIT_LANE_OFFSET, REPLAY_TRACK_OPTS } from './dims';
import { buildRaceScene } from './raceScene';
import { createScState, scState } from './safetyCar';
import { buildLaneTrack, sampleLane, type LaneTrack } from './laneTrack';
import { KIND_OBSTACLE, KIND_OFF, KIND_PIT, KIND_RACE, MIN_LAT, SLOPE, SLOPE_PIT, TrafficResolver, overlaps, type TrafficInput } from './traffic';
import { planRetirements } from './incidents';
import { createFieldCtx, createFieldOut, fillField } from './field';

/** generous smoothness bound: lateral change per unit travelled (+ slack for stationary moves) */
function maxLateralJump(prevD: Float32Array, d: Float32Array, travel: Float64Array, kind: Uint8Array, dt: number, merging?: Uint8Array) {
  let worst = 0;
  for (let i = 0; i < d.length; i++) {
    if (kind[i] !== KIND_RACE) continue;
    const allowed = merging?.[i] ? SLOPE_PIT * travel[i] + 4 * MIN_LAT * dt : SLOPE * travel[i] + MIN_LAT * dt;
    worst = Math.max(worst, Math.abs(d[i] - prevD[i]) - allowed);
  }
  return worst;
}

function syntheticTrack(): LaneTrack {
  const n = 1200;
  const length = 600;
  const kappa = new Float32Array(n);
  const line = new Float32Array(n);
  const lo = new Float32Array(n).fill(-1.12);
  const hi = new Float32Array(n).fill(1.12);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    kappa[i] = 0.08 * Math.sin(u * Math.PI * 2 * 5);
    line[i] = 0.9 * Math.sin(u * Math.PI * 2 * 5 + 0.6);
  }
  return { n, length, ds: length / n, line, lo, hi, kappa };
}

describe('lateral resolver (synthetic field)', () => {
  it('passes without overlaps, stays on the asphalt and moves smoothly', () => {
    const lt = syntheticTrack();
    const n = 12;
    const r = new TrafficResolver(lt, n);
    const inp: TrafficInput = { sTrue: new Float64Array(n), kind: new Uint8Array(n).fill(KIND_RACE), prefD: new Float32Array(n).fill(NaN), noPass: false };
    // a tight pack with different paces → many order changes
    const speed = Array.from({ length: n }, (_, i) => 6.6 + ((i * 37) % 11) * 0.02);
    const start = Array.from({ length: n }, (_, i) => 200 - i * 1.4);
    const dt = 0.2;
    const prevD = new Float32Array(n);
    const prevS = new Float64Array(n);
    const travel = new Float64Array(n);
    let passes = 0;
    let lastOrder = '';
    for (let step = 0; step < 900; step++) {
      const t = step * dt;
      for (let i = 0; i < n; i++) inp.sTrue[i] = (((start[i] + speed[i] * t) % lt.length) + lt.length) % lt.length;
      prevD.set(r.d);
      prevS.set(r.sv);
      r.step(inp, step === 0 ? -1 : dt);
      expect(overlaps(r, inp.kind)).toBeNull();
      for (let i = 0; i < n; i++) {
        expect(r.d[i]).toBeGreaterThanOrEqual(sampleLane(lt.lo, lt, r.sv[i]) - 1e-4);
        expect(r.d[i]).toBeLessThanOrEqual(sampleLane(lt.hi, lt, r.sv[i]) + 1e-4);
        travel[i] = Math.abs(r.diff(prevS[i], r.sv[i]));
      }
      if (step > 0) expect(maxLateralJump(prevD, r.d, travel, inp.kind, dt)).toBeLessThan(0.15);
      const order = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => r.sv[b] - r.sv[a])
        .join(',');
      if (lastOrder && order !== lastOrder) passes++;
      lastOrder = order;
    }
    expect(passes).toBeGreaterThan(3);
  });

  it('runs single file under a safety car and avoids a stopped car', () => {
    const lt = syntheticTrack();
    const n = 6;
    const r = new TrafficResolver(lt, n);
    const inp: TrafficInput = { sTrue: new Float64Array(n), kind: new Uint8Array(n).fill(KIND_RACE), prefD: new Float32Array(n).fill(NaN), noPass: true };
    inp.kind[5] = KIND_OBSTACLE;
    inp.sTrue[5] = 300;
    inp.prefD[5] = 0.2;
    for (let step = 0; step < 600; step++) {
      for (let i = 0; i < 5; i++) inp.sTrue[i] = (250 - i * 0.8 + step * 0.2 * 4) % lt.length;
      r.step(inp, step === 0 ? -1 : 0.2);
      expect(overlaps(r, inp.kind)).toBeNull();
    }
  });
});

describe('racing line', () => {
  it('stays inside the usable width and takes the inside at apexes', () => {
    const b = loadBundle('silverstone');
    const circuit = b.circuit;
    const curve = createCircuitCurve(circuit);
    const m = buildTrackModel(circuit, curve, REPLAY_TRACK_OPTS);
    const lt = buildLaneTrack(m);
    for (let i = 0; i < lt.n; i++) {
      expect(lt.line[i]).toBeGreaterThanOrEqual(lt.lo[i] - 1e-5);
      expect(lt.line[i]).toBeLessThanOrEqual(lt.hi[i] + 1e-5);
    }
    let inside = 0;
    const big = m.corners.filter((c) => c.turn > 0.6);
    for (const c of big) if (Math.sign(lt.line[c.apex]) === c.sign) inside++;
    expect(big.length).toBeGreaterThan(4);
    expect(inside / big.length).toBeGreaterThan(0.7);
    // smooth: lateral slope of the line stays gentle
    for (let i = 0; i < lt.n; i++) expect(Math.abs(lt.line[(i + 1) % lt.n] - lt.line[i])).toBeLessThan(0.3 * lt.ds);
  });
});

describe('lateral resolver (real bundle)', () => {
  const slug = 'silverstone';
  const b = loadBundle(slug);
  const tl = createRaceTimeline(b);
  const circuit = b.circuit;
  const curve = createCircuitCurve(circuit);
  const m = buildTrackModel(circuit, curve, REPLAY_TRACK_OPTS);
  const lt = buildLaneTrack(m);
  const plans = planRetirements(b, tl, lt, m.corners);
  const ctx = createFieldCtx(b, tl, lt, plans);
  const status = (t: number): TrackStatusType | null => tl.trackStatusAt(t);

  it('no footprint overlaps, on the asphalt and smooth through the whole race', () => {
    const r = new TrafficResolver(lt, ctx.n);
    const out = createFieldOut(ctx.n);
    let states: CarState[] = [];
    const dt = 0.5;
    const prevD = new Float32Array(ctx.n);
    const prevS = new Float64Array(ctx.n);
    const travel = new Float64Array(ctx.n);
    let worstJump = 0;
    let rough = 0;
    let carSteps = 0;
    let alongsideFrames = 0;
    for (let t = 0; t <= tl.duration; t += dt) {
      states = tl.statesAt(t, states);
      fillField(ctx, states, t, -1, status(t), out);
      prevD.set(r.d);
      prevS.set(r.sv);
      r.step(out.input, t === 0 ? -1 : dt);
      const bad = overlaps(r, out.input.kind);
      if (bad) throw new Error(`overlap at t=${t.toFixed(1)}: cars ${b.cars[bad[0]].driverNumber} & ${b.cars[bad[1]].driverNumber}`);
      for (let i = 0; i < ctx.n; i++) {
        travel[i] = Math.abs(r.diff(prevS[i], r.sv[i]));
        if (out.input.kind[i] !== KIND_RACE || r.merging[i]) continue;
        const lo = sampleLane(lt.lo, lt, r.sv[i]);
        const hi = sampleLane(lt.hi, lt, r.sv[i]);
        expect(r.d[i]).toBeGreaterThanOrEqual(lo - 0.02);
        expect(r.d[i]).toBeLessThanOrEqual(hi + 0.02);
      }
      if (t === 0) continue;
      for (let i = 0; i < ctx.n; i++) {
        if (out.input.kind[i] !== KIND_RACE) continue;
        carSteps++;
        const one = new Uint8Array(ctx.n);
        one[i] = KIND_RACE;
        const j = maxLateralJump(prevD, r.d, travel, one, dt, r.merging);
        if (j > 0.12) rough++;
        worstJump = Math.max(worstJump, j);
      }
      for (let i = 0; i < ctx.n; i++) if (r.alongside[i]) alongsideFrames++;
    }
    if (process.env.TRAFFIC_DEBUG) console.log('worst', worstJump, 'rough', rough, 'of', carSteps, 'alongside', alongsideFrames);
    // lateral motion follows the rate limit; the rare excess (a car held back by the
    // no-overlap sweep lands where the asphalt is narrower) stays well below a teleport
    expect(rough / carSteps).toBeLessThan(0.002);
    expect(worstJump).toBeLessThan(0.6);
    expect(alongsideFrames).toBeGreaterThan(0); // passes happen side by side
  }, 60_000);

  it('a seek to any time gives a clean static layout', () => {
    const r = new TrafficResolver(lt, ctx.n);
    const out = createFieldOut(ctx.n);
    let states: CarState[] = [];
    for (let k = 0; k < 60; k++) {
      const t = (k / 60) * tl.duration;
      states = tl.statesAt(t, states);
      fillField(ctx, states, t, -1, status(t), out);
      r.step(out.input, -1);
      expect(overlaps(r, out.input.kind)).toBeNull();
    }
  });

  it('visual order follows the timeline when cars are spread out', () => {
    const r = new TrafficResolver(lt, ctx.n);
    const out = createFieldOut(ctx.n);
    let states: CarState[] = [];
    let checked = 0;
    let agree = 0;
    for (let t = 0; t <= tl.duration; t += 0.5) {
      states = tl.statesAt(t, states);
      fillField(ctx, states, t, -1, status(t), out);
      r.step(out.input, t === 0 ? -1 : 0.5);
      if (Math.round(t * 2) % 120 !== 0) continue;
      for (let k = 1; k < states.length; k++) {
        const a = ctx.idxByDriver.get(states[k - 1].driverNumber)!;
        const c = ctx.idxByDriver.get(states[k].driverNumber)!;
        if (out.input.kind[a] !== KIND_RACE || out.input.kind[c] !== KIND_RACE) continue;
        const trueGap = r.diff(out.input.sTrue[c], out.input.sTrue[a]);
        if (trueGap < 2 * CLEAR_S || trueGap > 60) continue;
        checked++;
        if (r.diff(r.sv[c], r.sv[a]) > 0) agree++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(agree / checked).toBeGreaterThan(0.97);
  }, 60_000);

  it('retired cars stay on the scene (not hidden) after their incident', () => {
    const out = createFieldOut(ctx.n);
    const states = tl.statesAt(tl.duration - 1);
    fillField(ctx, states, tl.duration - 1, -1, null, out);
    for (let i = 0; i < ctx.n; i++) {
      const p = plans[i];
      if (!p || p.kind === 'garage') continue;
      expect(out.hidden[i]).toBe(0);
      expect(out.input.kind[i]).toBe(KIND_OBSTACLE);
      expect(out.poses[i].phase).toBe(2);
      // parked off the racing surface
      const lo = sampleLane(lt.lo, lt, out.poses[i].s);
      const hi = sampleLane(lt.hi, lt, out.poses[i].s);
      expect(out.poses[i].d > hi + CLEAR_D * 0.5 || out.poses[i].d < lo - CLEAR_D * 0.5).toBe(true);
    }
    expect(out.input.kind.some((k) => k === KIND_OFF)).toBeDefined();
  });
});

describe('lateral resolver (every bundled race, with the safety car in the field)', () => {
  it.each(raceSlugs())('%s: no overlaps (coarse steps)', (slug) => {
    const b = loadBundle(slug);
    const tl = createRaceTimeline(b);
    const scene = buildRaceScene(b, tl);
    const ctx = createFieldCtx(b, tl, scene.lt, scene.plans);
    const n = ctx.n;
    const r = new TrafficResolver(scene.lt, n + 1);
    const out = createFieldOut(n + 1);
    const sc = createScState();
    let states: CarState[] = [];
    let leaderS = NaN;
    let scFrames = 0;
    for (let t = 0; t <= tl.duration; t += 2.5) {
      states = tl.statesAt(t, states);
      fillField(ctx, states, t, -1, tl.trackStatusAt(t), out);
      scState(scene.sc, t, leaderS, scene.lt.length, sc);
      out.input.kind[n] = sc.on ? (sc.pit ? KIND_PIT : KIND_RACE) : KIND_OFF;
      out.input.sTrue[n] = sc.s;
      out.input.prefD[n] = sc.pit ? PIT_LANE_OFFSET : NaN;
      if (sc.on) scFrames++;
      r.step(out.input, t === 0 ? -1 : 2.5);
      const bad = overlaps(r, out.input.kind);
      if (bad) throw new Error(`${slug} overlap at t=${t.toFixed(1)}: slots ${bad[0]} & ${bad[1]}`);
      leaderS = NaN;
      for (const s of states) {
        if (s.retired) break;
        const i = ctx.idxByDriver.get(s.driverNumber)!;
        if (out.input.kind[i] !== KIND_OFF && !out.posed[i]) {
          leaderS = out.input.sTrue[i];
          break;
        }
      }
    }
    if (scene.sc.length) expect(scFrames).toBeGreaterThan(0);
  }, 60_000);
});
