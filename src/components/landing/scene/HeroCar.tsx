import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { F1Car, REAR_TYRE_OFFSETS, type CarPartId } from '@/components/three/F1Car';
import { useSeasonStore } from '@/store/seasonStore';
import { range01, smooth01 } from '@/hooks/useScrollChoreography';
import { placeAnchor, type HotspotId, type LandingBus } from '../bus';
import { DRIVE_LEN, driveCarZ, pathX, pathYaw, type LandingLayout } from '../layout';
import Kerb, { offsetLine } from './Kerb';
import { radialTexture } from './textures';

/** Hotspot anchors in car space (forward +Z, left = +X when viewed from the -X side). */
export const HOTSPOT_ANCHORS: Record<HotspotId, [number, number, number]> = {
  aero: [0, 1.12, -2.15],
  halo: [0, 0.98, 0.4],
  wake: [0, 0.9, -4.4],
  tyres: [-1.06, 0.4, -1.55],
};
const HIGHLIGHTS: Record<HotspotId, CarPartId[] | undefined> = {
  aero: ['frontWing', 'rearWing'],
  halo: ['monocoque'],
  wake: undefined,
  tyres: undefined,
};

const HeroModel = memo(function HeroModel({ highlight }: { highlight?: CarPartId[] }) {
  // wear the championship leader's real livery once season data is in
  const leaderTeam = useSeasonStore((st) => {
    const n = st.season?.driverStandings[0]?.driverNumber;
    return n != null ? st.driversByNumber.get(n)?.teamId : undefined;
  });
  return <F1Car teamId={leaderTeam} color="#D4FF00" accent="#11151b" tyreColor="#FF1E1E" tyreGlow={0.9} detail="high" highlight={highlight} />;
});

/* ------------------------------ skid ribbons ------------------------------ */

const skidVert = /* glsl */ `
attribute float aZ;
varying vec2 vUv; varying float vZ;
void main(){ vUv = uv; vZ = aZ; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skidFrag = /* glsl */ `
uniform float uHead; uniform float uTime;
varying vec2 vUv; varying float vZ;
void main(){
  float behind = uHead - vZ;
  if (behind < 0.0) discard;
  float across = abs(vUv.y - 0.5) * 2.0;
  float edge = smoothstep(1.0, 0.6, across);
  float tread = 0.78 + 0.22 * sin(vUv.y * 44.0) * sin(vUv.x * 0.9 + vUv.y * 7.0);
  float heat = exp(-behind / 6.0);
  vec3 rubber = vec3(0.012, 0.012, 0.014);
  vec3 hot = mix(vec3(1.0, 0.09, 0.09), vec3(1.0, 0.55, 0.05), heat);
  vec3 col = mix(rubber, hot * 1.4, clamp(heat * 1.1, 0.0, 1.0));
  // residual heat streaks along the whole mark
  float streak = smoothstep(0.86, 1.0, sin(vUv.y * 18.85 + 1.2)) * (0.35 + 0.65 * fract(sin(floor(vUv.x * 0.6) * 12.9898) * 43758.5));
  col += vec3(1.0, 0.32, 0.04) * streak * 0.4;
  // marbled grey rim
  col += vec3(0.11, 0.115, 0.125) * smoothstep(0.55, 0.95, across) * (1.0 - heat);
  float a = edge * (0.9 * tread) ;
  gl_FragColor = vec4(col, a);
}`;

function SkidMarks({ layout, headRef }: { layout: LandingLayout; headRef: MutableRefObject<number> }) {
  const geos = useMemo(() => {
    const step = 0.18;
    return REAR_TYRE_OFFSETS.map(([ox, , oz]) => {
      const pts: THREE.Vector3[] = [];
      const zs: number[] = [];
      for (let z = 0; z <= DRIVE_LEN + 0.001; z += step) {
        const yaw = pathYaw(layout.keys, z);
        const x = pathX(layout.keys, z);
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        pts.push(new THREE.Vector3(x + ox * c + oz * s, 0, z - ox * s + oz * c));
        zs.push(z);
      }
      // ribbon with an extra per-vertex car-z attribute for the heat/reveal shader
      const n = pts.length;
      const pos = new Float32Array(n * 6);
      const uv = new Float32Array(n * 4);
      const az = new Float32Array(n * 2);
      const idx: number[] = [];
      const t = new THREE.Vector3();
      let len = 0;
      const hw = 0.22;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        t.subVectors(b, a).normalize();
        if (i) len += pts[i].distanceTo(pts[i - 1]);
        const p = pts[i];
        pos.set([p.x + t.z * hw, 0.02, p.z - t.x * hw, p.x - t.z * hw, 0.02, p.z + t.x * hw], i * 6);
        uv.set([len, 0, len, 1], i * 4);
        az.set([zs[i], zs[i]], i * 2);
        if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('aZ', new THREE.BufferAttribute(az, 1));
      g.setIndex(idx);
      return g;
    });
  }, [layout]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skidVert,
        fragmentShader: skidFrag,
        uniforms: { uHead: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [],
  );
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    mat.uniforms.uHead.value = headRef.current;
  });
  return (
    <group renderOrder={2}>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} frustumCulled={false} renderOrder={2} />
      ))}
    </group>
  );
}

/** Apex kerbs on the inside of each swing of the drive path. */
function DriveKerbs({ layout }: { layout: LandingLayout }) {
  const kerbs = useMemo(() => {
    return layout.keys.slice(1, -2).map((k) => {
      const pts: THREE.Vector3[] = [];
      for (let z = k.z - 7; z <= k.z + 7; z += 0.5) pts.push(new THREE.Vector3(pathX(layout.keys, z), 0, z));
      // inside of the bend is toward the centre line
      const inside = k.x > 0 ? 1 : -1; // travelling +Z, right of travel is -X
      return { pts: offsetLine(pts, inside * 2.3), red: k.x > 0 };
    });
  }, [layout]);
  return (
    <>
      {kerbs.map((k, i) => (
        <Kerb key={i} points={k.pts} colors={k.red ? ['#FF1E1E', '#F2F2F2'] : ['#D4FF00', '#0B0E14']} width={0.9} block={1.0} glow={1.25} />
      ))}
    </>
  );
}

/* ----------------------------- dirty-air plume ----------------------------- */

const plumeFrag = /* glsl */ `
uniform float uTime; uniform float uOpacity;
varying vec2 vUv;
void main(){
  float along = vUv.y;              // 0 at the tail end, 1 at the car
  float n = sin(vUv.x * 18.0 + uTime * 4.0 + along * 9.0) * 0.5 + 0.5;
  n *= sin(vUv.x * 7.0 - uTime * 2.3 + along * 23.0) * 0.5 + 0.5;
  float a = pow(along, 1.3) * (0.35 + 0.65 * n) * uOpacity;
  gl_FragColor = vec4(vec3(1.0, 0.48, 0.0) * a, a);
}`;
const plumeVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

/* --------------------------------- hero car -------------------------------- */

export default function HeroCar({ bus, layout, hover }: { bus: LandingBus; layout: LandingLayout; hover: HotspotId | null }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Group>(null);
  const head = useRef(0);
  const tilt = useMemo(() => ({ x: 0, y: 0 }), []);
  const camera = useThree((s) => s.camera);
  const shadowTex = useMemo(() => radialTexture('rgba(0,0,0,0.9)', 'rgba(0,0,0,0)'), []);
  const plumeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plumeVert,
        fragmentShader: plumeFrag,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => {
    shadowTex.dispose();
    plumeMat.dispose();
  }, [shadowTex, plumeMat]);
  const anchorV = useMemo(() => new THREE.Vector3(), []);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

  useFrame((state, dt) => {
    const s = bus.choreo.current;
    const ch = s.chapters;
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    const reduced = s.reducedMotion;

    // drive (ch.3)
    const z = driveCarZ(layout, s.scrollY, ch[2].top);
    head.current = z;
    g.position.set(pathX(layout.keys, z), 0, z);
    g.rotation.y = pathYaw(layout.keys, z);

    // specimen weight (ch.2): fades in before the chapter, out into the drive
    const inSpec =
      smooth01(range01(s.scrollY, ch[1].top - s.vh * 0.3, ch[1].top + s.vh * 0.2)) *
      (1 - range01(s.scrollY, ch[2].top - s.vh * 0.2, ch[2].top + s.vh * 0.3));

    // pointer -> pitch / yaw
    const w = reduced ? 0 : inSpec;
    tilt.x = THREE.MathUtils.damp(tilt.x, -bus.pointer.y * 0.16 * w, 4, dt);
    tilt.y = THREE.MathUtils.damp(tilt.y, bus.pointer.x * 0.5 * w, 4, dt);
    b.rotation.set(tilt.x, tilt.y, 0);

    // dirty-air plume
    const wakeTarget = inSpec * (hoverRef.current === 'wake' ? 1.2 : 0.28);
    plumeMat.uniforms.uOpacity.value = THREE.MathUtils.damp(plumeMat.uniforms.uOpacity.value, wakeTarget, 5, dt);
    if (!reduced) plumeMat.uniforms.uTime.value = state.clock.elapsedTime;

    // tyre-ring pulse on hover
    const r = rings.current;
    if (r) {
      const on = hoverRef.current === 'tyres';
      r.visible = on;
      if (on) {
        const k = 1 + (reduced ? 0.1 : 0.12 + Math.sin(state.clock.elapsedTime * 6) * 0.1);
        r.children.forEach((c) => c.scale.setScalar(k));
      }
    }

    // project hotspot anchors to the DOM overlay
    g.updateMatrixWorld();
    const vis = inSpec * (1 - range01(ch[1].progress, 0.88, 0.98));
    const W = state.size.width;
    const H = state.size.height;
    (Object.keys(HOTSPOT_ANCHORS) as HotspotId[]).forEach((id) => {
      const el = bus.anchors[`hs-${id}`];
      if (!el) return;
      anchorV.set(...HOTSPOT_ANCHORS[id]);
      b.localToWorld(anchorV);
      placeAnchor(el, anchorV, camera, W, H, vis);
    });
  });

  const highlight = hover ? HIGHLIGHTS[hover] : undefined;

  return (
    <>
      <group ref={group}>
        <group ref={body}>
          <HeroModel highlight={highlight} />
          <group ref={rings} visible={false}>
            {[
              [-0.86, 1.65, 0.36],
              [0.86, 1.65, 0.36],
              [-0.84, -1.55, 0.37],
              [0.84, -1.55, 0.37],
            ].map(([x, zz, rr], i) => (
              <mesh key={i} position={[x + Math.sign(x) * 0.24, rr, zz]} rotation={[0, Math.PI / 2, 0]}>
                <torusGeometry args={[rr * 0.95, 0.035, 8, 32]} />
                <meshBasicMaterial color="#FF1E1E" toneMapped={false} transparent opacity={0.9} />
              </mesh>
            ))}
          </group>
          <mesh position={[0, 0.55, -5.2]} rotation={[Math.PI / 2, 0, 0]} material={plumeMat}>
            <planeGeometry args={[2.6, 6, 1, 1]} />
          </mesh>
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={1}>
          <planeGeometry args={[3.2, 7.2]} />
          <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
        </mesh>
      </group>
      <SkidMarks layout={layout} headRef={head} />
      <DriveKerbs layout={layout} />
    </>
  );
}
