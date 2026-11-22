import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CircuitEnvironment } from '@/components/track/CircuitEnvironment';
import { REAR_TYRE_OFFSETS } from '@/components/three/F1Car';
import type { LandingBus } from '../bus';
import { TRACK_WIDTH, type DrivePath } from './drivePath';

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
        pts.push(new THREE.Vector3(P.x + ox * c + oz * s, P.y + 0.06, P.z - ox * s + oz * c));
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
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
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

const traceFrag = /* glsl */ `
uniform float uHead; uniform float uOpacity;
varying vec2 vUv; varying float vS;
void main(){
  if (uHead - vS < 0.0) discard;
  float across = abs(vUv.y - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.35, across) * uOpacity;
  gl_FragColor = vec4(vec3(0.95, 0.05, 0.03) * 1.2, a);
}`;

/** Wide red trace of the lap driven so far, faded in only when the camera is high (overview). */
function LapTrace({ bus, path }: { bus: LandingBus; path: DrivePath }) {
  const geo = useMemo(() => {
    const step = 1.2;
    const n = Math.ceil(path.lapLen / step) + 1;
    const P = new THREE.Vector3();
    const H = new THREE.Vector3();
    const hw = 1.6;
    const pos = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const as = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = Math.min(1, (i * step) / path.lapLen);
      path.point(f, P);
      path.heading(f, H);
      pos.set([P.x + H.z * hw, P.y + 0.12, P.z - H.x * hw, P.x - H.z * hw, P.y + 0.12, P.z + H.x * hw], i * 6);
      uv.set([i, 0, i, 1], i * 4);
      as.set([f * path.lapLen, f * path.lapLen], i * 2);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aS', new THREE.BufferAttribute(as, 1));
    g.setIndex(idx);
    return g;
  }, [path]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skidVert,
        fragmentShader: traceFrag,
        uniforms: { uHead: { value: 0 }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -10,
        polygonOffsetUnits: -10,
      }),
    [],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ camera }) => {
    mat.uniforms.uHead.value = bus.lapT * path.lapLen;
    // invisible in the chase (~64 up), full in the overview (several hundred up)
    mat.uniforms.uOpacity.value = 0.85 * THREE.MathUtils.smoothstep(camera.position.y, 110, 260);
  });
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}

/**
 * The scroll-drive circuit: the shared <CircuitEnvironment> (real TUMFTM widths,
 * red/white kerbs, run-off, grass, grandstands, trees) placed so its start line is
 * the world origin, plus the lap-long skid ribbons. Only visible on the circuit set.
 */
export default function DriveTrack({ bus, path }: { bus: LandingBus; path: DrivePath }) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    if (root.current) root.current.visible = bus.set === 'circuit';
  });
  return (
    <group ref={root} visible={false}>
      <group position={path.position} rotation={[0, path.yaw, 0]} scale={path.scale}>
        <CircuitEnvironment circuit={path.circuit} curve={path.curve} quality="low" trackWidth={TRACK_WIDTH} minHalfWidth={1.1} />
      </group>
      <SkidMarks bus={bus} path={path} />
      <LapTrace bus={bus} path={path} />
    </group>
  );
}
