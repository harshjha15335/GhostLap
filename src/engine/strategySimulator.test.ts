import { describe, expect, it } from 'vitest';
import { loadBundle, raceSlugs } from './testUtils';
import { computePresets, defaultScenario, downforceLoss, MODEL, realStops, simulateGhost } from './strategySimulator';
import { getRaceModel, stopCost } from './raceModel';

const slugs = raceSlugs();

describe('ghost identity: unchanged scenario reproduces the real race', () => {
  it.each(slugs)('%s', (slug) => {
    const b = loadBundle(slug);
    const m = getRaceModel(b);
    for (const car of b.cars) {
      if (!car.laps.length) continue;
      for (const L of [1, Math.max(1, Math.floor(car.laps.length / 2)), car.laps.length]) {
        const r = simulateGhost(b, defaultScenario(b, car.driverNumber, L));
        expect(Math.abs(r.deltaSeconds)).toBeLessThan(1e-6);
        expect(r.laps).toHaveLength(car.laps.length);
        r.laps.forEach((t, i) => expect(t).toBeCloseTo(car.laps[i], 9));
        expect(r.positionsGained).toBe(0);
        expect(r.ghostFinishPosition).toBe(m.cars.get(car.driverNumber)!.rank);
        if (car.finishPosition != null) expect(r.ghostFinishPosition).toBe(car.finishPosition);
        expect(r.overtakes).toEqual([]);
        expect(r.verdict).toBe('No change from the real race.');
      }
    }
  });
});

describe('presets', () => {
  it.each(slugs)('%s: two valid presets whose expected outcome reproduces', (slug) => {
    const b = loadBundle(slug);
    const presets = computePresets(b);
    expect(presets).toHaveLength(2);
    expect(presets[0].label).toMatch(/^Undercut \d Laps? Earlier on (Softs|Mediums|Hards|Inters|Wets)$/);
    const hasNeutral = b.trackStatus.some((w) => w.type !== 'RED' && w.startLap >= 2 && w.startLap < b.totalLaps - 1);
    if (!hasNeutral) expect(presets[1].label).not.toMatch(/^Box Under/);
    expect(presets[0].scenario.driverNumber).not.toBe(presets[1].scenario.driverNumber);
    for (const p of presets) {
      expect(p.label.length).toBeLessThanOrEqual(34);
      const car = b.cars.find((c) => c.driverNumber === p.scenario.driverNumber)!;
      expect(car.status).toBe('FINISHED');
      for (const s of p.scenario.stops) {
        expect(s.lap).toBeGreaterThanOrEqual(p.scenario.fromLap);
        expect(s.lap).toBeLessThan(car.laps.length);
      }
      const r = simulateGhost(b, p.scenario);
      expect(r.positionsGained).toBe(p.expected.positionsGained);
      expect(r.deltaSeconds).toBeCloseTo(p.expected.deltaSeconds, 9);
      expect(r.ghostFinishPosition).toBe(p.expected.ghostFinishPosition);
      expect(r.realFinishPosition).toBe(p.expected.realFinishPosition);
      expect(r.verdict).toMatch(/P\d+ → P\d+ \([+−]\d+\.\d\ds\)$/);
    }
  });

  it('most races get a positive undercut and a positive second preset', () => {
    let positive = 0;
    for (const slug of slugs) {
      const [u, s] = computePresets(loadBundle(slug));
      if (u.expected.positionsGained > 0 || u.expected.deltaSeconds < 0) positive++;
      if (s.expected.positionsGained > 0 || s.expected.deltaSeconds < 0) positive++;
    }
    expect(positive).toBeGreaterThanOrEqual(Math.floor(slugs.length * 2 * 0.8));
  });

  it('silverstone undercut gains places as stated', () => {
    const b = loadBundle('silverstone');
    const [u] = computePresets(b);
    const r = simulateGhost(b, u.scenario);
    expect(r.positionsGained).toBeGreaterThan(0);
    expect(r.verdict).toMatch(/^Undercut works: /);
    expect(r.ghostFinishPosition).toBe(u.expected.ghostFinishPosition);
  });
});

describe('model sanity', () => {
  it('a needless extra stop makes the ghost slower', () => {
    for (const slug of ['silverstone', 'monza', 'kuala-lumpur', 'spielberg', 'melbourne']) {
      const b = loadBundle(slug);
      const m = getRaceModel(b);
      const winner = b.cars.find((c) => c.finishPosition === 1)!;
      // a green lap mid-race without a real stop nearby
      let lap = Math.floor(b.totalLaps * 0.6);
      while (m.status[lap - 1] || m.status[lap] || winner.pits.some((p) => Math.abs(p.lap - lap) <= 2)) lap++;
      const base = realStops(b, winner.driverNumber, 1);
      const comp = base.length ? base[base.length - 1].compound : winner.stints[0].compound;
      const stops = [...base, { lap, compound: comp }].filter((s) => s.lap >= lap);
      const r = simulateGhost(b, { driverNumber: winner.driverNumber, fromLap: lap, stops, avoidPenalties: false });
      // an SC / red flag later in the race compresses the loss, otherwise it costs ~a pit stop
      const compressed = m.spans.some((sp) => sp.start > lap);
      expect(r.deltaSeconds, slug).toBeGreaterThan(compressed ? 0 : 5);
      expect(r.ghostFinishPosition, slug).toBeGreaterThanOrEqual(1);
    }
  });

  it('removing all remaining stops changes tyre age continuously', () => {
    const b = loadBundle('silverstone');
    const w = b.cars.find((c) => c.finishPosition === 1)!;
    const r = simulateGhost(b, { driverNumber: w.driverNumber, fromLap: 2, stops: [], avoidPenalties: false });
    for (let i = 1; i < r.tyreAgeByLap.length; i++) expect(r.tyreAgeByLap[i]).toBe(r.tyreAgeByLap[i - 1] + 1);
    expect(r.pitLaps).toEqual([]);
  });

  it('avoidPenalties removes a served time penalty', () => {
    // Austin #63: 5 s time penalty served at a stop (no SC afterwards to compress it)
    const b = loadBundle('austin');
    const sc = defaultScenario(b, 63, 1);
    const r = simulateGhost(b, { ...sc, avoidPenalties: true });
    // −5 s at the stop, plus whatever cleaner air that buys afterwards
    expect(r.deltaSeconds).toBeLessThan(-4.9);
    expect(r.deltaSeconds).toBeGreaterThan(-5 - 0.3 * 56);
    expect(r.verdict).toMatch(/^Clean race/);
    const none = simulateGhost(b, { ...defaultScenario(b, 16, 1), avoidPenalties: true });
    expect(Math.abs(none.deltaSeconds)).toBeLessThan(1e-6);
  });

  it('avoidPenalties removes a post-race time penalty from the classification', () => {
    // Silverstone #12: 5 s added after the flag (P15)
    const b = loadBundle('silverstone');
    const r = simulateGhost(b, { ...defaultScenario(b, 12, 1), avoidPenalties: true });
    expect(r.deltaSeconds).toBeLessThan(-4);
    expect(r.ghostFinishPosition).toBeLessThan(15);
  });

  it('pit loss is discounted 40 % under SC/VSC and free under a red flag', () => {
    const b = loadBundle('silverstone'); // SC laps 48-52
    const m = getRaceModel(b);
    expect(m.status[47]).toBe('SC');
    expect(stopCost(m, 48, null, MODEL.safetyCarPitDiscount)).toBeCloseTo(0.6 * b.pitLossSeconds, 6);
    expect(stopCost(m, 30, null, MODEL.safetyCarPitDiscount)).toBeCloseTo(b.pitLossSeconds, 6);
    const monza = getRaceModel(loadBundle('monza')); // red flag laps 3-4
    expect(stopCost(monza, 3, null, MODEL.safetyCarPitDiscount)).toBe(0);
  });

  it('downforce loss / dirty air shape', () => {
    expect(downforceLoss(0.5)).toBe(1);
    expect(downforceLoss(1.0)).toBe(1);
    expect(downforceLoss(1.5)).toBeCloseTo(0.5);
    expect(downforceLoss(2.0)).toBe(0);
    expect(downforceLoss(Infinity)).toBe(0);
    expect(MODEL.dirtyAirMaxPenalty).toBeGreaterThan(0);
  });

  it('fitted tyre model is physically ordered', () => {
    for (const slug of slugs) {
      const { fit } = getRaceModel(loadBundle(slug));
      expect(fit.offset.SOFT).toBeLessThan(fit.offset.MEDIUM);
      expect(fit.offset.MEDIUM).toBeLessThan(fit.offset.HARD);
      expect(fit.deg.SOFT).toBeGreaterThanOrEqual(fit.deg.MEDIUM);
      expect(fit.deg.MEDIUM).toBeGreaterThanOrEqual(fit.deg.HARD);
    }
  });
});

describe('performance', () => {
  it('simulateGhost runs well under 30 ms per call', () => {
    const b = loadBundle('monte-carlo'); // 78 laps
    const w = b.cars.find((c) => c.finishPosition === 1)!;
    getRaceModel(b); // fitted once per bundle
    const N = 200;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      simulateGhost(b, { driverNumber: w.driverNumber, fromLap: 10, stops: [{ lap: 20 + (i % 30), compound: 'HARD' }], avoidPenalties: false });
    }
    const per = (performance.now() - t0) / N;
    expect(per).toBeLessThan(30);
  });

  it('first call on a fresh bundle (model fit + simulate) stays under 30 ms', () => {
    const b = JSON.parse(JSON.stringify(loadBundle('zandvoort')));
    const w = b.cars[0];
    const t0 = performance.now();
    simulateGhost(b, defaultScenario(b, w.driverNumber, 20));
    expect(performance.now() - t0).toBeLessThan(30);
  });
});
