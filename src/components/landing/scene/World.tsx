import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LandingBus } from '../bus';
import { S_CENTER_Z, U_CENTER_Z } from '../layout';
import Kerb from './Kerb';
import { asphaltTextures, radialTexture } from './textures';

const FLOOR_CENTER_Z = 150;
const DUST_BOX: [number, number, number] = [60, 14, 60];
const DUST_SPEED: [number, number, number] = [1.2, 0.25, 0.8];
const SPARK_BOX: [number, number, number] = [46, 3, 46];
const SPARK_SPEED: [number, number, number] = [6, 1.2, 3];
const FLOOR_SIZE = 900;

function Floor({ reflector }: { reflector: boolean }) {
  const tex = useMemo(() => asphaltTextures(512), []);
  useEffect(() => {
    tex.map.repeat.set(FLOOR_SIZE / 9, FLOOR_SIZE / 9);
    tex.rough.repeat.set(FLOOR_SIZE / 48, FLOOR_SIZE / 48);
    return () => {
      tex.map.dispose();
      tex.rough.dispose();
    };
  }, [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, FLOOR_CENTER_Z]}>
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      {reflector ? (
        <MeshReflectorMaterial
          map={tex.map}
          roughnessMap={tex.rough}
          color="#30353e"
          roughness={0.8}
          metalness={0.25}
          envMapIntensity={0.25}
          blur={[320, 90]}
          resolution={512}
          mixBlur={1.4}
          mixStrength={1.4}
          mixContrast={1.1}
          depthScale={1.1}
          minDepthThreshold={0.35}
          maxDepthThreshold={1.3}
          mirror={0.45}
        />
      ) : (
        <meshStandardMaterial map={tex.map} roughnessMap={tex.rough} color="#3a404a" roughness={0.5} metalness={0.25} envMapIntensity={0.3} />
      )}
    </mesh>
  );
}

/** Additive haze cone hanging under a floodlight head. */
const hazeVert = /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vV; varying float vTop;
void main(){
  vY = uv.y;
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vTop = normalize(cameraPosition - wp).y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const hazeFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying float vY; varying vec3 vN; varying vec3 vV; varying float vTop;
void main(){
  float f = pow(abs(dot(vN, vV)), 2.0);
  float a = pow(vY, 1.6) * f * uOpacity * (1.0 - smoothstep(0.45, 0.8, abs(vTop)));
  gl_FragColor = vec4(uColor * a, a);
}`;

function Floodlight({ position, aim = 0, color = '#dfe8ff', opacity = 0.22 }: { position: [number, number, number]; aim?: number; color?: string; opacity?: number }) {
  const hazeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hazeVert,
        fragmentShader: hazeFrag,
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [color, opacity],
  );
  const glowTex = useMemo(() => radialTexture('rgba(235,242,255,0.9)', 'rgba(235,242,255,0)'), []);
  useEffect(() => () => {
    hazeMat.dispose();
    glowTex.dispose();
  }, [hazeMat, glowTex]);
  const H = 24;
  return (
    <group position={position} rotation={[0, aim, 0]}>
      <mesh position={[0, H / 2, 0]}>
        <cylinderGeometry args={[0.12, 0.2, H, 6]} />
        <meshStandardMaterial color="#1b2029" roughness={0.6} metalness={0.6} />
      </mesh>
      <mesh position={[0, H, 0.4]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[3.2, 1.2, 0.3]} />
        <meshBasicMaterial color="#f2f6ff" toneMapped={false} />
      </mesh>
      <sprite position={[0, H, 0.8]} scale={[9, 9, 1]}>
        <spriteMaterial map={glowTex} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.8} fog={false} />
      </sprite>
      {/* haze cone tilted toward the track */}
      <mesh position={[0, H / 2 - 0.5, 6]} rotation={[-0.45, 0, 0]} material={hazeMat}>
        <coneGeometry args={[9, H + 2, 24, 1, true]} />
      </mesh>
    </group>
  );
}

/* --------------------------------- particles -------------------------------- */

const partVert = /* glsl */ `
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uSize; uniform float uPR;
attribute vec3 aVel; attribute vec2 aSeed;
varying float vA;
void main(){
  vec3 p = position + aVel * uTime;
  p.xz = mod(p.xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) + uCenter.xz - uBox.xz * 0.5;
  p.y = mod(p.y, uBox.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + aSeed.x) * uPR * (40.0 / max(1.0, -mv.z));
  vA = aSeed.y * (0.6 + 0.4 * sin(uTime * (2.0 + aSeed.x * 9.0) + aSeed.y * 40.0));
}`;
const partFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

function Particles({
  bus,
  count,
  color,
  size,
  box,
  speed,
  additive,
  opacity,
}: {
  bus: LandingBus;
  count: number;
  color: string;
  size: number;
  box: [number, number, number];
  speed: [number, number, number];
  additive: boolean;
  opacity: number;
}) {
  const gl = useThree((s) => s.gl);
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random() * box[0], Math.random() * box[1], Math.random() * box[2]], i * 3);
      vel.set([(Math.random() - 0.3) * speed[0], (Math.random() - 0.2) * speed[1], (Math.random() - 0.5) * speed[2]], i * 3);
      seed.set([Math.random(), Math.random()], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    const m = new THREE.ShaderMaterial({
      vertexShader: partVert,
      fragmentShader: partFrag,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...box) },
        uSize: { value: size },
        uPR: { value: 1 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    return { geo: g, mat: m };
  }, [count, color, size, box, speed, additive, opacity]);
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);
  useFrame((state) => {
    const reduced = bus.choreo.current.reducedMotion;
    if (!reduced) mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uCenter.value.copy(bus.focus);
    mat.uniforms.uPR.value = gl.getPixelRatio();
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/* --------------------------------- lights ---------------------------------- */

/**
 * One fixed light rig for both sets (light count never changes, so no shader
 * recompiles at the set swap): studio key / rims / fill follow the camera focus,
 * the hemisphere + sun are retuned for the dusk circuit.
 */
function LightRig({ bus }: { bus: LandingBus }) {
  const g = useRef<THREE.Group>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const studio = useRef<THREE.PointLight[]>([]);
  const base = [210, 260, 120, 60];
  const sky = useMemo(() => ({ s: new THREE.Color('#33415a'), c: new THREE.Color('#e3ecff'), gs: new THREE.Color('#06080b'), gc: new THREE.Color('#4d5a3e') }), []);
  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;
    o.position.x = THREE.MathUtils.damp(o.position.x, bus.focus.x, 2, dt);
    o.position.z = THREE.MathUtils.damp(o.position.z, bus.focus.z, 2, dt);
    const circuit = bus.set === 'circuit';
    studio.current.forEach((l, i) => l && (l.intensity = circuit ? 0 : base[i]));
    const h = hemi.current;
    if (h) {
      h.color.copy(circuit ? sky.c : sky.s);
      h.groundColor.copy(circuit ? sky.gc : sky.gs);
      h.intensity = circuit ? 1.35 : 0.5;
    }
    const d = sun.current;
    if (d) {
      d.intensity = circuit ? 2.1 : 0.55;
      d.color.set(circuit ? '#ffd9b0' : '#9fb4d6');
      d.position.set(bus.focus.x - 60, 80, bus.focus.z + (circuit ? 40 : 20));
      d.target.position.copy(bus.focus);
      d.target.updateMatrixWorld();
    }
  });
  const reg = (i: number) => (l: THREE.PointLight | null) => {
    if (l) studio.current[i] = l;
  };
  return (
    <>
      <hemisphereLight ref={hemi} args={['#33415a', '#06080b', 0.5]} />
      <directionalLight ref={sun} position={[-30, 50, 20]} intensity={0.55} color="#9fb4d6" />
      <group ref={g}>
        {/* key: front-left, high */}
        <pointLight ref={reg(0)} position={[-7, 10, 8]} intensity={210} distance={70} decay={2} color="#f2f5ff" />
        {/* rims: behind the car, cool white + warm */}
        <pointLight ref={reg(1)} position={[6, 6, -9]} intensity={260} distance={60} decay={2} color="#dfe8ff" />
        <pointLight ref={reg(2)} position={[-9, 4, -7]} intensity={120} distance={45} decay={2} color="#ffcf9e" />
        {/* soft fill from below-front */}
        <pointLight ref={reg(3)} position={[3, 2.2, 9]} intensity={60} distance={40} decay={2} color="#c9d6ff" />
      </group>
    </>
  );
}

/* ------------------------------- turntable --------------------------------- */

/** Hero plinth: a slightly lighter asphalt disc ringed by a real red/white kerb, plus a light pool. */
function Turntable() {
  const ring = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const R = 3.38;
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
    }
    return pts;
  }, []);
  const pool = useMemo(() => radialTexture('rgba(200,214,240,0.5)', 'rgba(200,214,240,0)'), []);
  useEffect(() => () => pool.dispose(), [pool]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <circleGeometry args={[3.08, 64]} />
        <meshStandardMaterial color="#4d545f" roughness={0.62} metalness={0.1} />
      </mesh>
      <Kerb points={ring} colors={['#E10600', '#F2F2F2']} width={0.6} block={0.78} glow={1.0} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial map={pool} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  );
}

/* ---------------------------------- world ---------------------------------- */

export default function World({ bus }: { bus: LandingBus }) {
  const q = bus.quality;
  const studio = useRef<THREE.Group>(null);
  useFrame(() => {
    if (studio.current) studio.current.visible = bus.set === 'studio';
  });

  return (
    <>
      <color attach="background" args={['#090c12']} />
      <fogExp2 attach="fog" args={['#090c12', 0.02]} />
      <LightRig bus={bus} />

      <Environment resolution={q.envResolution} frames={1} environmentIntensity={0.85}>
        <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#dfe6ff" position={[-10, 4, 6]} rotation-y={Math.PI / 2.5} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#cfe3ff" position={[10, 3, -6]} rotation-y={-Math.PI / 2.5} scale={[8, 1.5, 1]} />
      </Environment>

      <group ref={studio}>
        <Floor reflector={q.reflector} />
        <Turntable />

        {/* floodlight rigs: hero and flow regions */}
        <Floodlight position={[-16, 0, -14]} aim={0.6} />
        <Floodlight position={[18, 0, -20]} aim={-0.5} color="#ffe6c7" />
        <Floodlight position={[-70, 0, S_CENTER_Z - 46]} aim={0.2} />
        <Floodlight position={[0, 0, S_CENTER_Z - 50]} />
        <Floodlight position={[70, 0, S_CENTER_Z - 46]} aim={-0.2} color="#ffe6c7" />
        <Floodlight position={[-30, 0, U_CENTER_Z - 24]} aim={0.15} />
        <Floodlight position={[34, 0, U_CENTER_Z - 24]} aim={-0.15} color="#ffe6c7" />

        {/* rubber dust in the haze + hot sparks near the ground */}
        <Particles bus={bus} count={q.particles} color="#8a93a3" size={2.2} box={DUST_BOX} speed={DUST_SPEED} additive={false} opacity={0.55} />
        <Particles bus={bus} count={q.sparks} color="#FF7A00" size={1.6} box={SPARK_BOX} speed={SPARK_SPEED} additive opacity={1} />
      </group>
    </>
  );
}
