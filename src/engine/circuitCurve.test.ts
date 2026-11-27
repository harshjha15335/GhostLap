import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { CircuitGeometry, Vec3 } from '@/types';
import { loadBundle, raceSlugs } from './testUtils';
import { createCircuitCurve, trimClosingOvershoot } from './circuitCurve';

/** Every bundled circuit must close cleanly at the start/finish line (no overshoot at the seam). */
describe('circuit closure (every bundled circuit)', () => {
  it.each(raceSlugs())('%s: closes cleanly at the start/finish line', (slug) => {
    const g = loadBundle(slug).circuit;
    const p = g.points;
    // fixed at the source: nothing for the engine-side safety net to trim
    expect(trimClosingOvershoot(p)).toBe(p.length);
    if (g.widths) expect(g.widths.length).toBe(p.length);

    // the closing segment (last point → first) is an ordinary step forward
    let avg = 0;
    for (let i = 0; i < p.length - 1; i++) avg += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][2] - p[i][2]);
    avg /= p.length - 1;
    const close = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][2] - p[p.length - 1][2]);
    expect(close).toBeGreaterThan(avg * 0.3);
    expect(close).toBeLessThan(avg * 2);

    const cc = createCircuitCurve(g);
    expect(cc.pointCount).toBe(p.length);
    const N = 4000;
    const a = new Vector3();
    const b = new Vector3();
    const t = new Vector3();
    // monotonic arc length: every small step moves forward along the local tangent
    let back = 0;
    for (let k = 0; k < N; k++) {
      cc.pointAt(k / N, a);
      cc.pointAt((k + 1) / N, b);
      cc.tangentAt(k / N, t);
      if (b.sub(a).dot(t) <= 0) back++;
    }
    expect(back).toBe(0);

    // no self-overlap at the seam: just before the line is behind points[0], just after is ahead
    const p0 = cc.pointAt(0, new Vector3());
    const t0 = cc.tangentAt(0, new Vector3());
    const seam = Math.round(N * 0.02);
    for (let k = 1; k <= seam; k++) {
      expect(cc.pointAt(1 - k / N, a).sub(p0).dot(t0)).toBeLessThan(0);
      expect(cc.pointAt(k / N, a).sub(p0).dot(t0)).toBeGreaterThan(0);
    }

    // heading continuity across the line (and no kink anywhere near it)
    const before = cc.tangentAt(1 - 1e-4, new Vector3());
    const after = cc.tangentAt(1e-4, new Vector3());
    expect(before.angleTo(after)).toBeLessThan((5 * Math.PI) / 180);
    for (let k = -seam; k < seam; k++) {
      cc.tangentAt(k / N, a);
      cc.tangentAt((k + 1) / N, b);
      expect(a.angleTo(b)).toBeLessThan((10 * Math.PI) / 180);
    }
  });
});

describe('closing overshoot safety net', () => {
  it('trims tail points that run past the start of the loop', () => {
    const n = 200;
    const pts: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push([80 * Math.cos(a), 0, 50 * Math.sin(a)]);
    }
    // the trace continues 4 samples past points[0]
    for (let i = 0; i < 4; i++) {
      const a = (2 * Math.PI * (n + i)) / n + 0.004;
      pts.push([80 * Math.cos(a), 0, 50 * Math.sin(a)]);
    }
    const keep = trimClosingOvershoot(pts);
    expect(keep).toBeLessThanOrEqual(n);
    expect(keep).toBeGreaterThan(n - 3);
    const g: CircuitGeometry = { slug: 'x', name: 'x', lengthKm: 5, points: pts, sectorSplits: [0.33, 0.66], elevationRangeM: 0 };
    const cc = createCircuitCurve(g);
    expect(cc.pointCount).toBe(keep);
    // no doubling back at the seam
    const before = cc.tangentAt(1 - 1e-4, new Vector3());
    const after = cc.tangentAt(1e-4, new Vector3());
    expect(before.angleTo(after)).toBeLessThan(0.2);
  });
});
