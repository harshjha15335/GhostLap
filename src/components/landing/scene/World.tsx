import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LandingBus } from '../bus';
import { PALETTE } from '../palette';

/** sRGB hex -> raw 0..1 triplet (the backdrop shader writes display values directly). */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const backVert = /* glsl */ `
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const backFrag = /* glsl */ `
uniform vec2 uRes; uniform float uPR; uniform float uScroll;
uniform float uHorizon; uniform float uSag;
uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uInk;
void main(){
  vec2 px = gl_FragCoord.xy / uPR;
  float docY = uScroll + (uRes.y - px.y);
  float hw = uRes.x * 0.5;
  float dx = px.x - hw;
  // a huge circle through the horizon centre and (±hw, horizon - sag): sky colour inside
  float R = (hw * hw + uSag * uSag) / (2.0 * uSag);
  float bound = uHorizon - (R - sqrt(max(R * R - dx * dx, 0.0)));
  float t = smoothstep(bound - 0.8, bound + 0.8, docY);
  vec3 col = mix(uTop, uBottom, t);
  // halftone ramp: a 45-degree dot screen (document space, scrolls with the page) whose
  // dots swell toward the horizon on both sides, like a pop-art print gradient
  const float CELL = 18.0;
  vec2 q = vec2(px.x + docY, docY - px.x) * 0.70710678 / CELL;
  vec2 f = (fract(q) - 0.5) * CELL;
  float ramp = 1.0 - smoothstep(0.0, 520.0, abs(docY - bound));
  float r = 1.0 + 3.6 * ramp * ramp;
  float dotMask = 1.0 - smoothstep(r - 0.7, r + 0.7, length(f));
  col = mix(col, uInk, dotMask * 0.16);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Full-screen backdrop for the hero + specimen chapters: an ultramarine sky above a big
 * curved horizon and hot magenta below it, with a halftone dot ramp around the horizon. Positioned in document space (it
 * scrolls 1:1 with the page) and drawn first, behind everything in the scene.
 */
function Backdrop({ bus }: { bus: LandingBus }) {
  const gl = useThree((s) => s.gl);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: backVert,
        fragmentShader: backFrag,
        uniforms: {
          uRes: { value: new THREE.Vector2(1, 1) },
          uPR: { value: 1 },
          uScroll: { value: 0 },
          uHorizon: { value: 800 },
          uSag: { value: 150 },
          uTop: { value: rgb(PALETTE.sky) },
          uBottom: { value: rgb(PALETTE.horizon) },
          uInk: { value: rgb(PALETTE.ink) },
        },
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state) => {
    const u = mat.uniforms;
    u.uRes.value.set(state.size.width, state.size.height);
    u.uPR.value = gl.getPixelRatio();
    u.uScroll.value = bus.choreo.current.scrollY;
    u.uHorizon.value = bus.horizon.y;
    u.uSag.value = Math.max(1, bus.horizon.sag);
  });
  return (
    <mesh frustumCulled={false} renderOrder={-1000} material={mat}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

/** Daylight rig for a bright pop-coloured world: sky/ground hemisphere + one warm sun. */
function LightRig({ bus }: { bus: LandingBus }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const f = bus.focus;
    const d = sun.current;
    if (d) {
      d.position.set(f.x - 30, f.y + 60, f.z + 40);
      d.target.position.copy(f);
      d.target.updateMatrixWorld();
    }
    const r = rim.current;
    if (r) {
      r.position.set(f.x + 30, f.y + 20, f.z - 40);
      r.target.position.copy(f);
      r.target.updateMatrixWorld();
    }
  });
  return (
    <>
      <hemisphereLight args={['#fff7ee', '#8a3a7a', 1.25]} />
      <directionalLight ref={sun} intensity={2.6} color="#fff4e2" />
      <directionalLight ref={rim} intensity={1.1} color="#e8f2ff" />
    </>
  );
}

export default function World({ bus }: { bus: LandingBus }) {
  const q = bus.quality;
  return (
    <>
      <color attach="background" args={[PALETTE.sky]} />
      <Backdrop bus={bus} />
      <LightRig bus={bus} />
      <Environment resolution={q.envResolution} frames={1} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 4, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#ffe6f2" position={[-10, 4, 6]} rotation-y={Math.PI / 2.5} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#e6f0ff" position={[10, 3, -6]} rotation-y={-Math.PI / 2.5} scale={[8, 1.5, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#ff8fbf" position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>
    </>
  );
}
