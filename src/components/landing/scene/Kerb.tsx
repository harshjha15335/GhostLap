import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * Glowing apex kerb: alternating instanced blocks laid along a polyline.
 * Unlit + toneMapped:false so it reads as lit paint under floodlights.
 */
export default function Kerb({
  points,
  colors,
  width = 1.1,
  block = 1.2,
  glow = 1.4,
}: {
  points: THREE.Vector3[];
  colors: [string, string];
  width?: number;
  block?: number;
  glow?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const segs = useMemo(() => {
    // resample by arc length into blocks
    const out: { p: THREE.Vector3; yaw: number }[] = [];
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const d = a.distanceTo(b);
      let s = block - acc;
      while (s <= d) {
        const p = a.clone().lerp(b, s / d);
        out.push({ p, yaw: Math.atan2(b.x - a.x, b.z - a.z) });
        s += block;
      }
      acc = d - (s - block);
    }
    return out;
  }, [points, block]);

  const geo = useMemo(() => new THREE.BoxGeometry(width, 0.08, block * 0.98), [width, block]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const ca = new THREE.Color(colors[0]).multiplyScalar(glow);
    const cb = new THREE.Color(colors[1]).multiplyScalar(colors[1] === '#000000' || colors[1] === '#0B0E14' ? 1 : glow);
    segs.forEach((s, i) => {
      o.position.set(s.p.x, 0.04, s.p.z);
      o.rotation.set(0, s.yaw, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, i % 2 ? cb : ca);
    });
    m.count = segs.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [segs, colors, glow]);

  useLayoutEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  if (!segs.length) return null;
  return <instancedMesh ref={ref} args={[geo, mat, segs.length]} frustumCulled={false} />;
}

/** Offset a polyline sideways (positive = right of travel), on the ground. */
export function offsetLine(points: THREE.Vector3[], offset: number): THREE.Vector3[] {
  const t = new THREE.Vector3();
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    t.subVectors(b, a).setY(0).normalize();
    return new THREE.Vector3(p.x - t.z * offset, 0, p.z + t.x * offset);
  });
}
