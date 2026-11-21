import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Flat ribbon along a polyline on the XZ plane.
 * uv.x = cumulative length (world units), uv.y = 0..1 across the width.
 * `offset` shifts the ribbon sideways (positive = to the right of travel).
 */
export function ribbonGeometry(points: THREE.Vector3[], width: number, offset = 0, y = 0): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx: number[] = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).setY(0).normalize();
    // right of travel for +Y up: (t.z, 0, -t.x) points left; use (-t.z, 0, t.x) for right
    side.set(-t.z, 0, t.x);
    if (i > 0) len += p.distanceTo(points[i - 1]);
    const cx = p.x + side.x * offset;
    const cz = p.z + side.z * offset;
    const hw = width / 2;
    pos.set([cx - side.x * hw, p.y + y, cz - side.z * hw, cx + side.x * hw, p.y + y, cz + side.z * hw], i * 6);
    uv.set([len, 0, len, 1], i * 4);
    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // force up-facing normals (winding can flip with offset sign)
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

/** Evenly spaced points (by arc length) along a curve. */
export function samplePoints(curve: THREE.Curve<THREE.Vector3>, count: number, from = 0, to = 1): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) out.push(curve.getPointAt(from + ((to - from) * i) / (count - 1)));
  return out;
}

function colorize(g: THREE.BufferGeometry, hex: string) {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function part(g: THREE.BufferGeometry, x: number, y: number, z: number, hex: string, rx = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return colorize(g, hex);
}

/**
 * Single merged low-poly car (forward +Z, ~5.2 long) with vertex colours:
 * white = takes the instance (team) colour, dark = carbon/tyres, neon = accents.
 */
export function miniCarGeometry(): THREE.BufferGeometry {
  const W = '#ffffff';
  const C = '#1a1d22';
  const T = '#0b0b0d';
  const parts = [
    part(new THREE.BoxGeometry(0.62, 0.4, 2.6), 0, 0.42, 0.25, W),
    part(new THREE.CylinderGeometry(0.1, 0.26, 1.3, 8), 0, 0.36, 2.0, W, Math.PI / 2),
    part(new THREE.BoxGeometry(1.0, 0.34, 1.6), 0, 0.34, -0.25, W),
    part(new THREE.BoxGeometry(0.46, 0.2, 1.4), 0, 0.7, -0.8, W),
    part(new THREE.BoxGeometry(1.5, 0.05, 3.6), 0, 0.08, -0.1, C),
    part(new THREE.BoxGeometry(1.8, 0.04, 0.36), 0, 0.14, 2.55, C),
    part(new THREE.BoxGeometry(1.0, 0.05, 0.36), 0, 0.98, -2.15, C),
    part(new THREE.BoxGeometry(0.06, 0.5, 0.1), 0, 0.68, -2.05, C),
    part(new THREE.BoxGeometry(0.4, 0.06, 0.6), 0, 0.66, 0.45, C),
  ];
  for (const [x, z, r, w] of [
    [-0.86, 1.65, 0.36, 0.3],
    [0.86, 1.65, 0.36, 0.3],
    [-0.84, -1.55, 0.37, 0.38],
    [0.84, -1.55, 0.37, 0.38],
  ]) {
    parts.push(part(new THREE.CylinderGeometry(r, r, w, 10), x, r, z, T, 0, Math.PI / 2));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()), false) as THREE.BufferGeometry;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}
