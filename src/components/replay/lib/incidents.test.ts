import { describe, expect, it } from 'vitest';
import { loadBundle, raceSlugs } from '@/engine/testUtils';
import { createRaceTimeline } from '@/engine/raceInterpolator';
import { buildRaceScene } from './raceScene';
import { planS, retirePose, type RetirePose } from './incidents';
import { towerOrder } from './towerOrder';
import { createFieldCtx, createFieldOut, fillField } from './field';
import { KIND_OFF } from './traffic';

const pose = (): RetirePose => ({ s: 0, d: 0, yaw: 0, phase: 0, since: 0, speed: 0 });

describe('retirements at their real stop point (location feed)', () => {
  const slugs = raceSlugs();
  let exactCount = 0;

  it.each(slugs)('%s: retired cars come to rest exactly where and when the data says', (slug) => {
    const b = loadBundle(slug);
    const tl = createRaceTimeline(b);
    const scene = buildRaceScene(b, tl);
    const L = scene.lt.length;
    b.cars.forEach((car, i) => {
      const p = scene.plans[i];
      if (car.status !== 'DNF') {
        expect(p).toBeNull();
        return;
      }
      expect(p).not.toBeNull();
      if (!p) return;
      const ret = car.retirement;
      expect(ret, `#${car.driverNumber} has a retirement record`).toBeDefined();
      // ordered phases; the plan takes over no later than the timeline retires the car
      expect(p.tTake).toBeLessThanOrEqual(p.tRetire + 1e-6);
      expect(p.tStop).toBeGreaterThanOrEqual(p.tTake - 1e-6);
      expect(p.tRest).toBeGreaterThan(p.tStop);
      // monotonic, no teleports: speed stays below ~2× a racing lap's pace
      const vMax = (2 * L) / p.lapTime + 1;
      let prev = planS(p, p.tTake);
      for (let t = p.tTake + 0.25; t <= p.tRest + 5; t += 0.25) {
        const s = planS(p, t);
        expect(s).toBeGreaterThanOrEqual(prev - 1e-4);
        expect(s - prev).toBeLessThan(vMax * 0.25);
        prev = s;
      }
      if (!ret || ret.kind === 'unknown') return;
      exactCount++;
      expect(p.exact).toBe(true);
      // at the real time (a few seconds later at most, when the timeline's lap end disagrees)
      expect(p.tRest).toBeGreaterThanOrEqual(ret.time - 1e-6);
      expect(p.tRest - ret.time).toBeLessThan(25);
      if (Math.abs(p.tRest - ret.time) < 1e-6) expect(p.tRest).toBeCloseTo(ret.time, 3);
      // … and at the real place
      const at = retirePose(p, p.tRest + 1, scene.lt, pose());
      expect(at.phase).toBe(2);
      let df = Math.abs(at.s / L - ret.lapFraction);
      df = Math.min(df, 1 - df);
      if (p.kind === 'garage') expect(df).toBeLessThan(0.08);
      else expect(df).toBeLessThan(0.002);
      expect(p.kind).toBe(ret.kind === 'crash' ? 'crash' : ret.kind === 'pits' ? 'garage' : 'stop');
    });
  });

  it('the data has exact stop points for most retirements', () => {
    expect(exactCount).toBeGreaterThan(60);
  });

  it('Spa: Russell (#63) crashes on lap 1 at Les Combes, ~39 s after the start', () => {
    const b = loadBundle('spa-francorchamps');
    const car = b.cars.find((c) => c.driverNumber === 63)!;
    expect(car.retirement?.kind).toBe('crash');
    expect(car.retirement?.lap).toBe(1);
    expect(car.retirement!.lapFraction).toBeGreaterThan(0.3);
    expect(car.retirement!.lapFraction).toBeLessThan(0.4);
    expect(car.retirement!.time).toBeGreaterThan(30);
    expect(car.retirement!.time).toBeLessThan(45);
  });

  it.each(slugs)('%s: the tower shows a retiring car running until it comes to rest, then out', (slug) => {
    const b = loadBundle(slug);
    const tl = createRaceTimeline(b);
    const scene = buildRaceScene(b, tl);
    const ctx = createFieldCtx(b, tl, scene.lt, scene.plans);
    const out = createFieldOut(ctx.n);
    scene.plans.forEach((p, i) => {
      if (!p) return;
      const dn = b.cars[i].driverNumber;
      for (const t of [Math.max(p.tTake, p.tRest - 1), p.tRest + 0.5]) {
        const states = tl.statesAt(t);
        const order = towerOrder(states, scene.plans, scene.idxByDriver, t, scene.lt.length);
        const row = order.find((s) => s.driverNumber === dn)!;
        expect(row.retired).toBe(t >= p.tRest);
        // positions are 1..n in order
        order.forEach((s, k) => expect(s.position).toBe(k + 1));
        // the scene draws it (garage cars disappear into the garage once parked)
        fillField(ctx, states, t, -1, null, out);
        if (p.kind !== 'garage' || t < p.tRest) expect(out.hidden[i]).toBe(0);
        if (t >= p.tRest && p.kind !== 'garage') expect(out.input.kind[i]).not.toBe(KIND_OFF);
      }
    });
  });
});
