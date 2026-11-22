import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LandingBus } from '../bus';
import { PALETTE } from '../palette';
import { acquirePaperTexture, releasePaperTexture } from './textures';

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
uniform vec3 uTop; uniform vec3 uBottom;
uniform sampler2D uPaper; uniform float uTile;
void main(){
  vec2 px = gl_FragCoord.xy / uPR;
  float docY = uScroll + (uRes.y - px.y);
  float hw = uRes.x * 0.5;
  float dx = px.x - hw;
  // a huge circle through the horizon centre and (±hw, horizon - sag): chartreuse inside
  float R = (hw * hw + uSag * uSag) / (2.0 * uSag);
  float bound = uHorizon - (R - sqrt(max(R * R - dx * dx, 0.0)));
  float t = smoothstep(bound - 0.8, bound + 0.8, docY);
  vec3 col = mix(uTop, uBottom, t);
  float paper = texture2D(uPaper, vec2(px.x, docY) / uTile).r;
  col *= mix(1.0, paper, mix(1.0, 0.75, t));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Full-screen paper backdrop for the hero + specimen chapters: chartreuse paper above a
 * big curved horizon and deep racing green below it. Positioned in document space (it
 * scrolls 1:1 with the page) and drawn first, behind everything in the scene.
 */
function Backdrop({ bus }: { bus: LandingBus }) {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => acquirePaperTexture(), []);
  useEffect(() => () => releasePaperTexture(), []);
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
          uTop: { value: rgb(PALETTE.chartreuse) },
          uBottom: { value: rgb(PALETTE.green) },
          uPaper: { value: null },
          uTile: { value: 1100 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => {
    mat.uniforms.uPaper.value = tex;
  }, [mat, tex]);
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

/** Daylight rig for a bright, paper-coloured world: sky/ground hemisphere + one warm sun. */
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
      <hemisphereLight args={['#fffdf2', '#5d7a2c', 1.25]} />
      <directionalLight ref={sun} intensity={2.6} color="#fff4e2" />
      <directionalLight ref={rim} intensity={1.1} color="#e8f2ff" />
    </>
  );
}

export default function World({ bus }: { bus: LandingBus }) {
  const q = bus.quality;
  return (
    <>
      <color attach="background" args={[PALETTE.chartreuse]} />
      <Backdrop bus={bus} />
      <LightRig bus={bus} />
      <Environment resolution={q.envResolution} frames={1} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 4, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#f4ffe0" position={[-10, 4, 6]} rotation-y={Math.PI / 2.5} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#e6f0ff" position={[10, 3, -6]} rotation-y={-Math.PI / 2.5} scale={[8, 1.5, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#cfe86a" position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>
    </>
  );
}
