import { describe, expect, it } from 'vitest';
import { loadBundle, raceSlugs } from '@/engine/testUtils';
import { createCircuitCurve } from '@/engine/circuitCurve';
import { buildTrackModel, hasRealWidths, unitsPerMetre } from './trackModel';
import { buildAsphalt, buildBarriers, buildKerbs, buildLayout, buildLines, buildStructures, buildTerrain, buildVerges, scatterProps } from './geometry';

const TUMFTM = [
  'austin', 'catalunya', 'hungaroring', 'interlagos', 'kuala-lumpur', 'melbourne', 'mexico-city', 'montreal',
  'monza', 'shanghai', 'silverstone', 'spa-francorchamps', 'spielberg', 'suzuka', 'zandvoort',
];

describe('track widths in the bundles', () => {
  it.each(raceSlugs())('%s: one plausible [left, right] pair per point', (slug) => {
    const c = loadBundle(slug).circuit;
    expect(c.widths).toBeDefined();
    expect(c.widths!.length).toBe(c.points.length);
    const upm = unitsPerMetre(c);
    for (const [l, r] of c.widths!) {
      expect(l).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(0);
      const total = (l + r) / upm;
      expect(total).toBeGreaterThan(7.5);
      expect(total).toBeLessThan(26);
    }
    expect(hasRealWidths(c)).toBe(TUMFTM.includes(slug));
  });
});

describe('circuit environment model', () => {
  it.each(raceSlugs())('%s: layout keeps the asphalt usable for the replay lanes', (slug) => {
    const c = loadBundle(slug).circuit;
    const cc = createCircuitCurve(c);
    const m = buildTrackModel(c, cc, { quality: 'low', trackWidth: 3.4, minHalfWidth: 1.5, pitLane: { offset: 3.05, width: 1.3 }, pitSpan: 0.075 });
    let mean = 0;
    for (let i = 0; i < m.n; i++) {
      expect(m.hwL[i]).toBeGreaterThanOrEqual(1.5 - 1e-3);
      expect(m.hwR[i]).toBeGreaterThanOrEqual(1.5 - 1e-3);
      mean += m.hwL[i] + m.hwR[i];
    }
    mean /= m.n;
    expect(mean).toBeGreaterThan(3.2);
    expect(mean).toBeLessThan(3.9);
    expect(m.corners.length).toBeGreaterThan(5);
    const lay = buildLayout(m, 'low');
    // pit lane never overlaps the track: its inner edge stays outside the right edge
    for (let i = 0; i < m.n; i++) {
      if (Number.isNaN(lay.pitCentre[i])) continue;
      if (lay.pitBlend[i] > 0.99) expect(lay.pitCentre[i]).toBeCloseTo(3.05, 1);
      // (the entry / exit tapers merge into the track edge on purpose)
      if (lay.pitBlend[i] > 0.6) expect(lay.pitCentre[i] - 0.65).toBeGreaterThan(m.hwR[i]);
      for (const S of [lay.L, lay.R]) expect(S.barrier[i]).toBeGreaterThanOrEqual(S.edge[i]);
    }
    const t = buildTerrain(m, lay, { quality: 'low', seed: 1, urban: false });
    // the ground never pokes through the asphalt
    for (let i = 0; i < m.n; i += 7) expect(t.heightAt(m.px[i], m.pz[i])).toBeLessThan(m.py[i] + 0.02);
    const geos = [t.geometry, buildAsphalt(m, lay), buildVerges(m, lay, 1), buildKerbs(m, lay), buildLines(m, lay, c.sectorSplits), buildBarriers(m, lay, t), buildStructures(m, lay, 'low', 1).geometry];
    for (const g of geos) {
      const p = g.getAttribute('position');
      expect(p.count).toBeGreaterThan(0);
      for (let k = 0; k < p.count; k += 97) expect(Number.isFinite(p.getY(k))).toBe(true);
      g.dispose();
    }
    const props = scatterProps(m, lay, t, { quality: 'low', seed: 1, urban: false });
    expect(props.trees.matrices.length).toBeLessThanOrEqual(700);
    expect(props.buildings.matrices.length).toBeLessThanOrEqual(170);
  });
});
