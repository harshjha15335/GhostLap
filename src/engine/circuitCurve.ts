import { CatmullRomCurve3, Vector3 } from 'three';
import type { CircuitGeometry } from '@/types';

export interface CircuitCurve {
  curve: CatmullRomCurve3;
  /** length in render units */
  length: number;
  /** position at lap fraction f (0..1, wraps) */
  pointAt(f: number, target?: Vector3): Vector3;
  /** unit tangent (racing direction) at lap fraction f */
  tangentAt(f: number, target?: Vector3): Vector3;
}

const cache = new WeakMap<CircuitGeometry, CircuitCurve>();

/** Closed centripetal Catmull-Rom spline through the circuit points (arc-length parameterised). */
export function createCircuitCurve(geometry: CircuitGeometry): CircuitCurve {
  const hit = cache.get(geometry);
  if (hit) return hit;
  const pts = geometry.points.map(([x, y, z]) => new Vector3(x, y, z));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = Math.max(400, pts.length * 4);
  curve.updateArcLengths();
  const wrap = (f: number) => ((f % 1) + 1) % 1;
  const cc: CircuitCurve = {
    curve,
    length: curve.getLength(),
    pointAt: (f, target = new Vector3()) => curve.getPointAt(wrap(f), target),
    tangentAt: (f, target = new Vector3()) => curve.getTangentAt(wrap(f), target),
  };
  cache.set(geometry, cc);
  return cc;
}
