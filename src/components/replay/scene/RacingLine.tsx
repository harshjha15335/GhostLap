import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { frame } from '../lib/frame';
import type { RaceScene } from '../lib/raceScene';

/**
 * The computed racing line (lib/laneTrack.ts) painted on the asphalt as a thin ribbon,
 * coloured by curvature side (entry / apex / exit reads at a glance). Fades in with the
 * top-down camera only, so the broadcast / chase views stay clean. 1 draw call.
 */
export function RacingLine({ scene }: { scene: RaceScene }) {
  const { model: m, lt } = scene;
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const geo = useMemo(() => {
    const n = m.n;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const col = new Float32Array((n + 1) * 2 * 3);
    const idx: number[] = [];
    const w = 0.16;
    const a = new THREE.Color('#D4FF00');
    const b = new THREE.Color('#FF2D8A');
    const c = new THREE.Color();
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      const d = lt.line[i];
      const cx = m.px[i] + m.rx[i] * d;
      const cz = m.pz[i] + m.rz[i] * d;
      const y = m.py[i] + 0.06;
      pos.set([cx - m.rx[i] * w, y, cz - m.rz[i] * w, cx + m.rx[i] * w, y, cz + m.rz[i] * w], k * 6);
      // neon on straights → pink where the line is hard over (apex / track-out)
      const span = Math.max(0.2, (lt.hi[i] - lt.lo[i]) / 2);
      c.copy(a).lerp(b, Math.min(1, Math.abs(d - (lt.hi[i] + lt.lo[i]) / 2) / span));
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
      if (k > 0 && Math.floor(k / 3) % 2 === 0) {
        const o = k * 2;
        idx.push(o - 2, o - 1, o, o - 1, o + 1, o);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, [m, lt]);
  useEffect(() => () => geo.dispose(), [geo]);

  useFrame(() => {
    const mm = mat.current;
    if (!mm) return;
    mm.opacity = Math.max(0, (frame.topW - 0.3) / 0.7) * 0.85;
    mm.visible = mm.opacity > 0.01;
  });

  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={1}>
      <meshBasicMaterial ref={mat} vertexColors transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} opacity={0} />
    </mesh>
  );
}
