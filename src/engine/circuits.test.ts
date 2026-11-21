import { describe, expect, it } from 'vitest';
import { loadBundle, raceSlugs } from './testUtils';
import { circuitStats, circuitSvgPath, circuitSvgStart } from '@/data/circuits';
import { createCircuitCurve } from './circuitCurve';
import { loadSeedRace, loadSeedSeason, SEED_SLUGS } from '@/data/seed2026';

describe('circuit helpers', () => {
  it.each(raceSlugs())('%s: stats and svg path derived from geometry', (slug) => {
    const g = loadBundle(slug).circuit;
    const s = circuitStats(g);
    expect(s.lengthKm).toBe(g.lengthKm);
    expect(s.lengthKm).toBeGreaterThan(3);
    expect(s.lengthKm).toBeLessThan(7.5);
    expect(s.corners).toBeGreaterThanOrEqual(7);
    expect(s.corners).toBeLessThanOrEqual(25);
    expect(s.longestStraightKm).toBeGreaterThan(0.1);
    expect(s.longestStraightKm).toBeLessThan(2);
    expect(s.longestStraightFraction).toBeCloseTo(s.longestStraightKm / s.lengthKm, 1);
    expect(s.cornerApexes).toHaveLength(s.corners);
    const d = circuitSvgPath(g, 100);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(100);
    const [sx, sy] = circuitSvgStart(g, 100);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sy).toBeLessThanOrEqual(100);
    const curve = createCircuitCurve(g);
    expect(curve.length).toBeGreaterThan(0);
  });

  it('Monza is the low-corner, long-straight circuit; Monaco the shortest', () => {
    const monza = circuitStats(loadBundle('monza').circuit);
    const monaco = circuitStats(loadBundle('monte-carlo').circuit);
    expect(monza.corners).toBeLessThan(monaco.corners + 1);
    expect(monza.longestStraightKm).toBeGreaterThan(monaco.longestStraightKm);
    expect(monaco.lengthKm).toBeLessThan(3.6);
  });
});

describe('embedded seed fallback', () => {
  it('season + seed races load and are complete bundles', async () => {
    const season = await loadSeedSeason();
    expect(season.year).toBe(2026);
    expect(season.races.length).toBeGreaterThan(20);
    for (const slug of SEED_SLUGS) {
      const b = await loadSeedRace(slug);
      expect(b, slug).not.toBeNull();
      expect(b!.summary.slug).toBe(slug);
      expect(b!.cars.length).toBeGreaterThan(15);
      expect(b!.circuit.points.length).toBeGreaterThan(100);
    }
    expect(await loadSeedRace('not-a-race')).toBeNull();
  });
});
