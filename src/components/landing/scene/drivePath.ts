import * as THREE from 'three';
import type { CircuitGeometry } from '@/types';
import { createCircuitCurve, type CircuitCurve } from '@/engine/circuitCurve';

/** The circuit the scroll-drive chapter laps. */
export const DRIVE_SLUG = 'silverstone';
/** world units per circuit render unit (the car is 5.2 world units long) */
export const TRACK_SCALE = 3;
/** mean full track width in circuit render units (×TRACK_SCALE in the world) */
export const TRACK_WIDTH = 3.4;

/**
 * A real circuit placed in the landing world so that its start/finish line sits at
 * the world origin with the racing direction along +Z — exactly where (and how) the
 * hero car is parked in the studio chapters. Lap fraction f is arc-length based, so
 * f × lengthKm is the distance into the lap.
 */
export interface DrivePath {
  circuit: CircuitGeometry;
  curve: CircuitCurve;
  scale: number;
  /** transform of the circuit group: world = position + Ry(yaw) · scale · local */
  position: THREE.Vector3;
  yaw: number;
  matrix: THREE.Matrix4;
  /** lap length, world units */
  lapLen: number;
  /** world-space bounds of the centre line (x/z) */
  bounds: { cx: number; cz: number; hx: number; hz: number };
  /** world position at lap fraction f */
  point(f: number, out?: THREE.Vector3): THREE.Vector3;
  /** horizontal unit heading at f, averaged over ±`window` world units (0 = exact tangent) */
  heading(f: number, out?: THREE.Vector3, window?: number): THREE.Vector3;
  /** sector (1..3) at f, from the data's sector splits */
  sector(f: number): 1 | 2 | 3;
}

const Y = new THREE.Vector3(0, 1, 0);

export function buildDrivePath(circuit: CircuitGeometry, scale = TRACK_SCALE): DrivePath {
  const curve = createCircuitCurve(circuit);
  const p0 = curve.pointAt(0);
  const t0 = curve.tangentAt(0);
  // rotate so the start heading points along +Z
  const yaw = -Math.atan2(t0.x, t0.z);
  const quat = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
  const position = p0.clone().multiplyScalar(scale).applyQuaternion(quat).negate();
  const matrix = new THREE.Matrix4().compose(position, quat, new THREE.Vector3(scale, scale, scale));
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const lapLen = curve.length * scale;

  const point = (f: number, out = new THREE.Vector3()) => curve.pointAt(f, out).applyMatrix4(matrix);
  const heading = (f: number, out = new THREE.Vector3(), window = 0) => {
    if (window <= 0) {
      curve.tangentAt(f, out).applyQuaternion(quat);
    } else {
      const d = window / lapLen;
      point(f + d, out);
      point(f - d, tmp2);
      out.sub(tmp2);
    }
    out.y = 0;
    return out.lengthSq() > 1e-9 ? out.normalize() : out.set(0, 0, 1);
  };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 400; i++) {
    point(i / 400, tmp);
    minX = Math.min(minX, tmp.x);
    maxX = Math.max(maxX, tmp.x);
    minZ = Math.min(minZ, tmp.z);
    maxZ = Math.max(maxZ, tmp.z);
  }
  const [s1, s2] = circuit.sectorSplits;
  return {
    circuit,
    curve,
    scale,
    position,
    yaw,
    matrix,
    lapLen,
    bounds: { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2 },
    point,
    heading,
    sector: (f) => (f < s1 ? 1 : f < s2 ? 2 : 3),
  };
}
