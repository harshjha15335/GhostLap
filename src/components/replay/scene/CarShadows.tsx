import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CAR_SCALE } from '../lib/dims';
import { frame } from '../lib/frame';

/**
 * Soft contact shadows under every car (and the safety car): one instanced draw call,
 * a radial-alpha quad per car laid on the track. Part of the replay's quality ladder
 * (off on Low).
 */
const MAX = 26;

const VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const FS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p * vec2(1.0, 0.85));
    float a = 0.42 * (1.0 - smoothstep(0.35, 1.0, d));
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.05, 0.06, 0.08, a);
  }
`;

export function CarShadows() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2.6, 6.2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false });
    const ctx = { m: null as THREE.InstancedMesh | null, k: 0, dummy: new THREE.Object3D() };
    // stable callback: no per-frame allocation
    const place = (g: THREE.Object3D | null | undefined) => {
      const m = ctx.m;
      if (!m || !g || !g.visible || ctx.k >= MAX) return;
      const d = ctx.dummy;
      d.position.copy(g.position);
      d.position.y += 0.025;
      d.quaternion.copy(g.quaternion);
      d.scale.setScalar(g.scale.x / CAR_SCALE);
      d.updateMatrix();
      m.setMatrixAt(ctx.k++, d.matrix);
    };
    return { geo, mat, ctx, place };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    res.ctx.m = m;
    res.ctx.k = 0;
    frame.carGroups.forEach(res.place);
    res.place(frame.safetyCar);
    m.count = res.ctx.k;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[res.geo, res.mat, MAX]} frustumCulled={false} renderOrder={1} />;
}
