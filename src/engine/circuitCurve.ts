import { CatmullRomCurve3, Vector3 } from 'three';
import type { CircuitGeometry, Vec3 } from '@/types';

export interface CircuitCurve {
  curve: CatmullRomCurve3;
  /** length in render units */
  length: number;
  /**
   * Number of circuit points the curve runs through: `geometry.points.length`, unless a
   * closing overshoot was trimmed (see trimClosingOvershoot), in which case it is smaller.
   */
  pointCount: number;
  /** position at lap fraction f (0..1, wraps) */
  pointAt(f: number, target?: Vector3): Vector3;
  /** unit tangent (racing direction) at lap fraction f */
  tangentAt(f: number, target?: Vector3): Vector3;
}

const cache = new WeakMap<CircuitGeometry, CircuitCurve>();

/**
 * Number of leading points to keep so the loop closes cleanly at points[0].
 *
 * A lap trace cut with a little padding runs a few samples PAST the start point before
 * the loop closes: those tail points lie ahead of points[0] (along the start direction)
 * and very close to it, so a closed spline through them doubles back at the line and a
 * car crossing it flips round. The data pipeline now trims traces to exactly one lap;
 * this is the engine-side safety net for any geometry that still overshoots. Points that
 * are near the start (< 8 average spacings) and not clearly behind it (along the start
 * tangent > −½ spacing) are dropped from the end, at most 16 of them.
 */
export function trimClosingOvershoot(p: readonly Vec3[]): number {
  const n = p.length;
  if (n <= 8) return n;
  let avg = 0;
  for (let i = 0; i < n - 1; i++) avg += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][2] - p[i][2]);
  avg /= n - 1;
  const tx = p[1][0] - p[0][0];
  const tz = p[1][2] - p[0][2];
  const tl = Math.hypot(tx, tz) || 1;
  let keep = n;
  while (keep > n - 16) {
    const q = p[keep - 1];
    const along = ((q[0] - p[0][0]) * tx + (q[2] - p[0][2]) * tz) / tl;
    const dist = Math.hypot(q[0] - p[0][0], q[2] - p[0][2]);
    if (dist < avg * 8 && along > -avg * 0.5) keep--;
    else break;
  }
  return keep;
}

/** Closed centripetal Catmull-Rom spline through the circuit points (arc-length parameterised). */
export function createCircuitCurve(geometry: CircuitGeometry): CircuitCurve {
  const hit = cache.get(geometry);
  if (hit) return hit;
  const keep = trimClosingOvershoot(geometry.points);
  const pts = geometry.points.slice(0, keep).map(([x, y, z]) => new Vector3(x, y, z));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = Math.max(400, pts.length * 4);
  curve.updateArcLengths();
  const wrap = (f: number) => ((f % 1) + 1) % 1;
  const cc: CircuitCurve = {
    curve,
    length: curve.getLength(),
    pointCount: keep,
    pointAt: (f, target = new Vector3()) => curve.getPointAt(wrap(f), target),
    tangentAt: (f, target = new Vector3()) => curve.getTangentAt(wrap(f), target),
  };
  cache.set(geometry, cc);
  return cc;
}
