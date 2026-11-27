import type { CircuitGeometry } from '@/types';

/**
 * The bundled centre lines close with a few points that run slightly PAST points[0]
 * (the loop overlaps itself by ~1–2 render units at the start/finish line). A closed
 * Catmull-Rom through them doubles back there, so a car crossing the line jumped back
 * and flipped round for a frame. This drops those trailing points (and their widths)
 * for the replay. (Reported for a data/engine-level fix; the replay is self-contained.)
 */
const cache = new WeakMap<CircuitGeometry, CircuitGeometry>();

export function cleanCircuit(c: CircuitGeometry): CircuitGeometry {
  const hit = cache.get(c);
  if (hit) return hit;
  const p = c.points;
  const n = p.length;
  let out = c;
  if (n > 8) {
    let avg = 0;
    for (let i = 0; i < n - 1; i++) avg += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][2] - p[i][2]);
    avg /= n - 1;
    const tx = p[1][0] - p[0][0];
    const tz = p[1][2] - p[0][2];
    const tl = Math.hypot(tx, tz) || 1;
    let keep = n;
    // drop tail points that are beyond (or too close behind) the start point along the start tangent
    // (the overshoot can reach ~5 spacings past the line before it turns back)
    while (keep > n - 16) {
      const q = p[keep - 1];
      const along = ((q[0] - p[0][0]) * tx + (q[2] - p[0][2]) * tz) / tl;
      const dist = Math.hypot(q[0] - p[0][0], q[2] - p[0][2]);
      if (dist < avg * 8 && along > -avg * 0.5) keep--;
      else break;
    }
    if (keep < n) {
      out = { ...c, points: p.slice(0, keep), widths: c.widths && c.widths.length === n ? c.widths.slice(0, keep) : c.widths };
    }
  }
  cache.set(c, out);
  return out;
}
