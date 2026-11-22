import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { F1Car, type CarPartId } from '@/components/three/F1Car';
import { useSeasonStore } from '@/store/seasonStore';
import { range01, smooth01 } from '@/hooks/useScrollChoreography';
import { placeAnchor, type HotspotId, type LandingBus } from '../bus';
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

const TAU = Math.PI * 2;
/** hero turntable start yaw (front 3/4 to camera) and speed, rad/s */
const SPIN0 = 0.6;
const SPIN_SPEED = 0.32;

/** critically-damped-ish spring step */
function spring(st: { x: number; v: number }, target: number, k: number, c: number, dt: number) {
  st.v += (k * (target - st.x) - c * st.v) * dt;
  st.x += st.v * dt;
}

export default function HeroCar({ bus, hover }: { bus: LandingBus; hover: HotspotId | null }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Group>(null);
  const tilt = useMemo(() => ({ p: { x: 0, v: 0 }, r: { x: 0, v: 0 }, y: { x: 0, v: 0 } }), []);
  const spin = useRef(SPIN0);
  const canon = useRef(0);
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
  const head = useMemo(() => new THREE.Vector3(), []);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = bus.choreo.current;
    const ch = s.chapters;
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    const reduced = s.reducedMotion;
    g.visible = bus.showCar;

    // hero (ch.1) weight: 1 at the top, 0 once the specimen chapter is reached
    const inHero = 1 - smooth01(range01(s.scrollY, ch[1].top - s.vh * 0.55, ch[1].top + s.vh * 0.3));
    // specimen weight (ch.2): fades in before the chapter, out into the drive
    const inSpec =
      smooth01(range01(s.scrollY, ch[1].top - s.vh * 0.3, ch[1].top + s.vh * 0.2)) *
      (1 - range01(s.scrollY, ch[2].top - s.vh * 0.2, ch[2].top + s.vh * 0.3));

    if (bus.set === 'circuit' && bus.path) {
      // drive (ch.3): ride the real racing line
      bus.path.point(bus.lapT, g.position);
      bus.path.heading(bus.lapT, head);
      g.rotation.y = Math.atan2(head.x, head.z);
    } else {
      // turntable: spins in the hero, eases to the nearest whole turn for the specimen study
      if (!reduced) spin.current += SPIN_SPEED * dt * inHero;
      // the target whole turn is latched while fully in the hero, so the ease never jumps
      if (inHero > 0.999) canon.current = Math.round(spin.current / TAU) * TAU;
      g.position.set(0, 0, 0);
      g.rotation.y = reduced ? SPIN0 * inHero : canon.current + (spin.current - canon.current) * smooth01(inHero);
    }

    // pointer -> spring tilt (hero + specimen)
    const w = reduced ? 0 : Math.max(inSpec, inHero);
    const k = 70;
    const c = 11;
    spring(tilt.p, -bus.pointer.y * 0.14 * w, k, c, dt);
    spring(tilt.r, -bus.pointer.x * 0.07 * w * inHero, k, c, dt);
    spring(tilt.y, bus.pointer.x * 0.45 * w, k, c, dt);
    b.rotation.set(tilt.p.x, tilt.y.x, tilt.r.x);

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
        const kk = 1 + (reduced ? 0.1 : 0.12 + Math.sin(state.clock.elapsedTime * 6) * 0.1);
        r.children.forEach((cc) => cc.scale.setScalar(kk));
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
      {/* soft contact shadow: a wide penumbra plus a tight core under the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, -0.1]} renderOrder={1}>
        <planeGeometry args={[3.6, 7.6]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} opacity={0.75} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.075, -0.1]} renderOrder={1}>
        <planeGeometry args={[2.3, 5.6]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} opacity={0.9} />
      </mesh>
    </group>
  );
}
