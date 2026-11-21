import { describe, expect, it } from 'vitest';
import { loadBundle, raceSlugs } from './testUtils';
import { createRaceTimeline } from './raceInterpolator';
import { computePresets, defaultScenario, simulateGhost } from './strategySimulator';

const slugs = raceSlugs();

describe('race timeline', () => {
  it.each(slugs)('%s: positions at the flag match the official classification', (slug) => {
    const b = loadBundle(slug);
    const tl = createRaceTimeline(b);
    const end = tl.statesAt(tl.duration);
    expect(end).toHaveLength(b.cars.length);
    end.forEach((s, i) => expect(s.position).toBe(i + 1));
    const classifiedNum = new Set(b.cars.filter((c) => c.finishPosition != null).map((c) => c.driverNumber));
    const finished = end.filter((s) => s.finished && classifiedNum.has(s.driverNumber)).map((s) => s.driverNumber);
    const official = b.cars
      .filter((c) => c.status === 'FINISHED' && c.laps.length && c.finishPosition != null)
      .sort((x, y) => x.finishPosition! - y.finishPosition!)
      .map((c) => c.driverNumber);
    expect(finished).toEqual(official);
    // finished cars first, retired cars last
    const firstRetired = end.findIndex((s) => s.retired);
    if (firstRetired >= 0) expect(end.slice(firstRetired).every((s) => s.retired)).toBe(true);
    for (const c of b.cars) {
      const s = end.find((x) => x.driverNumber === c.driverNumber)!;
      expect(s.retired).toBe(c.status !== 'FINISHED' || !c.laps.length);
    }
  });

  it.each(slugs)('%s: grid at t=0, monotone progress, sane gaps', (slug) => {
    const b = loadBundle(slug);
    const tl = createRaceTimeline(b);
    const start = tl.statesAt(0);
    const running = start.filter((s) => !s.retired);
    for (const s of running) {
      expect(s.progress).toBeLessThanOrEqual(0);
      expect(s.progress).toBeGreaterThan(-0.1);
      expect(s.lap).toBe(1);
    }
    // grid order = qualifying order
    const grid = running.map((s) => b.cars.find((c) => c.driverNumber === s.driverNumber)!.gridPosition ?? 99);
    for (let i = 1; i < grid.length; i++) expect(grid[i]).toBeGreaterThanOrEqual(grid[i - 1]);

    const winner = b.cars.find((c) => c.finishPosition === 1)!;
    let prev = -Infinity;
    for (let t = 0; t <= tl.duration; t += tl.duration / 400) {
      const p = tl.progressAt(winner.driverNumber, t);
      expect(p.progress).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(p.lapFraction).toBeGreaterThanOrEqual(0);
      expect(p.lapFraction).toBeLessThanOrEqual(1);
      prev = p.progress;
    }
    const mid = tl.statesAt(tl.duration * 0.5);
    expect(mid[0].gapToLeader).toBe(0);
    for (const s of mid) {
      expect(Number.isNaN(s.gapToLeader)).toBe(false);
      expect(s.gapToLeader).toBeGreaterThanOrEqual(0);
    }
    expect(tl.timeAtLap(1)).toBe(0);
    expect(tl.leaderLapAt(tl.timeAtLap(10) + 1)).toBe(10);
  });

  it('red-flag laps park the cars in the pit lane', () => {
    const b = loadBundle('monza'); // red flag laps 3-4
    const tl = createRaceTimeline(b);
    const w = b.cars.find((c) => c.finishPosition === 1)!;
    const cum = tl.cumulative.get(w.driverNumber)!;
    const idx = w.laps.findIndex((t) => t > 1000);
    expect(idx).toBeGreaterThan(0);
    const tMid = (cum[idx - 1] + cum[idx]) / 2;
    const s = tl.statesAt(tMid).find((x) => x.driverNumber === w.driverNumber)!;
    expect(s.inPit).toBe(true);
    expect(s.lapFraction).toBeCloseTo(0.97, 2);
    expect(tl.trackStatusAt(tMid)).toBe('RED');
  });

  it('retired cars freeze and drop to the back', () => {
    const b = loadBundle('silverstone');
    const tl = createRaceTimeline(b);
    const dnf = b.cars.find((c) => c.status === 'DNF')!;
    const cum = tl.cumulative.get(dnf.driverNumber)!;
    const later = tl.statesAt(cum[cum.length - 1] + 60);
    const s = later.find((x) => x.driverNumber === dnf.driverNumber)!;
    expect(s.retired).toBe(true);
    expect(s.position).toBeGreaterThan(later.filter((x) => !x.retired).length);
  });

  it('statesAt reuses the output array and is fast', () => {
    const b = loadBundle('monte-carlo');
    const tl = createRaceTimeline(b);
    const out = tl.statesAt(100);
    const first = out[0];
    tl.statesAt(200, out);
    expect(out[0]).toBe(first);
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) tl.statesAt((i / N) * tl.duration, out);
    const per = (performance.now() - t0) / N;
    expect(per).toBeLessThan(1); // ms per frame for 20+ cars
  });

  it('ghost replay: unchanged ghost tracks the real car; preset ghost has a state', () => {
    const b = loadBundle('silverstone');
    const tl = createRaceTimeline(b);
    const w = b.cars.find((c) => c.finishPosition === 3)!;
    const g = simulateGhost(b, defaultScenario(b, w.driverNumber, 1));
    for (const t of [0, 500, 2500, 5000]) {
      expect(tl.ghostProgressAt(g, t).progress).toBeCloseTo(tl.progressAt(w.driverNumber, t).progress, 9);
    }
    const p = computePresets(b)[0];
    const pg = simulateGhost(b, p.scenario);
    const st = tl.ghostStateAt(pg, tl.duration);
    expect(st.finished).toBe(true);
    expect(st.position).toBeGreaterThanOrEqual(1);
  });
});
