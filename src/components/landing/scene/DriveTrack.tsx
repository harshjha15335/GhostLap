import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { REAR_TYRE_OFFSETS } from '@/components/three/F1Car';
import type { LandingBus } from '../bus';
import { ROAD_WIDTH, type DrivePath } from './drivePath';
import Road, { PaperGround } from './Road';

/* ------------------------------ skid ribbons ------------------------------ */

const skidVert = /* glsl */ `
attribute float aS;
varying vec2 vUv; varying float vS;
void main(){ vUv = uv; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skidFrag = /* glsl */ `
uniform float uHead;
varying vec2 vUv; varying float vS;
void main(){
  float behind = uHead - vS;
  if (behind < 0.0) discard;
  float across = abs(vUv.y - 0.5) * 2.0;
  float edge = smoothstep(1.0, 0.55, across);
  float tread = 0.8 + 0.2 * sin(vUv.y * 44.0) * sin(vUv.x * 0.9 + vUv.y * 7.0);
  float heat = exp(-behind / 6.0);
  vec3 rubber = vec3(0.025, 0.025, 0.028);
  vec3 hot = mix(vec3(1.0, 0.12, 0.08), vec3(1.0, 0.6, 0.08), heat);
  vec3 col = mix(rubber, hot * 1.3, clamp(heat * 1.1, 0.0, 1.0));
  float a = edge * tread * mix(0.62, 0.95, heat);
  gl_FragColor = vec4(col, a);
}`;

/** Twin rubber ribbons from the rear tyres along the whole lap, revealed up to the car. */
function SkidMarks({ bus, path }: { bus: LandingBus; path: DrivePath }) {
  const geos = useMemo(() => {
    const step = 0.4;
    const n = Math.ceil(path.lapLen / step) + 1;
    const P = new THREE.Vector3();
    const H = new THREE.Vector3();
    return REAR_TYRE_OFFSETS.map(([ox, , oz]) => {
      const pts: THREE.Vector3[] = [];
      const ss: number[] = [];
      for (let i = 0; i < n; i++) {
        const f = Math.min(1, (i * step) / path.lapLen);
        path.point(f, P);
        path.heading(f, H);
        // car space -> world (yaw from heading)
        const c = H.z;
        const s = H.x;
        pts.push(new THREE.Vector3(P.x + ox * c + oz * s, P.y + 0.045, P.z - ox * s + oz * c));
        ss.push(f * path.lapLen);
      }
      const pos = new Float32Array(n * 6);
      const uv = new Float32Array(n * 4);
      const as = new Float32Array(n * 2);
      const idx: number[] = [];
      const t = new THREE.Vector3();
      let len = 0;
      const hw = 0.24;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        t.subVectors(b, a).setY(0).normalize();
        if (i) len += pts[i].distanceTo(pts[i - 1]);
        const p = pts[i];
        pos.set([p.x + t.z * hw, p.y, p.z - t.x * hw, p.x - t.z * hw, p.y, p.z + t.x * hw], i * 6);
        uv.set([len, 0, len, 1], i * 4);
        as.set([ss[i], ss[i]], i * 2);
        if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('aS', new THREE.BufferAttribute(as, 1));
      g.setIndex(idx);
      return g;
    });
  }, [path]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skidVert,
        fragmentShader: skidFrag,
        uniforms: { uHead: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    mat.uniforms.uHead.value = bus.lapT * path.lapLen;
  });
  return (
    <>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} frustumCulled={false} renderOrder={2} />
      ))}
    </>
  );
}

/** Chartreuse paper ground under the drive road (matches the DOM chapter colour). */
export const DRIVE_GROUND = '#C8FF1A';

/**
 * The scroll-drive set: a winding road with kerbs on a chartreuse paper ground, plus the
 * lap-long skid ribbons revealed up to the car. Only visible while the drive is on stage.
 */
export default function DriveTrack({ bus, path }: { bus: LandingBus; path: DrivePath }) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    if (root.current) root.current.visible = bus.set === 'circuit';
  });
  const spec = useMemo(
    () => ({
      points: path.points,
      width: ROAD_WIDTH,
      kerbs: path.kerbs,
      runoff: 2.6,
      runoffColor: '#2FA84F',
      checkers: [path.sStart, path.sEnd],
    }),
    [path],
  );
  const b = path.bounds;
  return (
    <group ref={root} visible={false}>
      <PaperGround color={DRIVE_GROUND} center={[b.cx, b.cz]} size={[b.hx * 2 + 900, b.hz * 2 + 900]} />
      <Road spec={spec} />
      <SkidMarks bus={bus} path={path} />
    </group>
  );
}
