import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { RaceBundle } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import { F1Car, COMPOUND_COLORS } from '@/components/three/F1Car';
import { useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { CAR_SCALE, GHOST_LANE, PIT_LANE_OFFSET, frame } from '../lib/frame';
import { tyreWear, wakeIntensity } from '../lib/raceMath';

const UP = new THREE.Vector3(0, 1, 0);
const GREY = new THREE.Color('#5b6068');
const AMBER = new THREE.Color('#FF7A00');

/** Shared geometries (car-local metres; the car group carries CAR_SCALE). */
function makeWakeGeometry() {
  const len = 16;
  const g = new THREE.ConeGeometry(2.6, len, 24, 6, true);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const a = Math.pow((y + len / 2) / len, 1.6); // 1 at apex → 0 at mouth
    col[i * 4] = AMBER.r;
    col[i * 4 + 1] = AMBER.g;
    col[i * 4 + 2] = AMBER.b;
    col[i * 4 + 3] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.rotateX(Math.PI / 2); // apex → +Z (towards the car)
  g.scale(1, 0.35, 1); // hug the ground
  g.translate(0, 0.45, -(len / 2 + 2.4));
  return g;
}

function makeHaloGeometry() {
  const g = new THREE.RingGeometry(1.7, 1.92, 40);
  g.rotateX(-Math.PI / 2);
  g.scale(1, 1, 1.75);
  g.translate(0, 0.03, 0);
  return g;
}

interface CarsProps {
  bundle: RaceBundle;
  timeline: RaceTimeline;
  curve: CircuitCurve;
}

export const Cars = memo(function Cars({ bundle, timeline, curve }: CarsProps) {
  const lookup = useDriverLookup();
  const setFocus = useRaceLab((s) => s.setFocusDriver);
  const n = bundle.cars.length;

  const shared = useMemo(() => {
    const wakeGeo = makeWakeGeometry();
    const haloGeo = makeHaloGeometry();
    const hitGeo = new THREE.BoxGeometry(3.2, 2.2, 6.5);
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const wakeMats = bundle.cars.map(
      () =>
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
    );
    const haloMats = bundle.cars.map(
      () =>
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
    );
    return { wakeGeo, haloGeo, hitGeo, hitMat, wakeMats, haloMats };
  }, [bundle]);

  useEffect(
    () => () => {
      shared.wakeGeo.dispose();
      shared.haloGeo.dispose();
      shared.hitGeo.dispose();
      shared.hitMat.dispose();
      shared.wakeMats.forEach((m) => m.dispose());
      shared.haloMats.forEach((m) => m.dispose());
    },
    [shared],
  );

  const groups = useRef<(THREE.Group | null)[]>([]);
  const wakes = useRef<(THREE.Mesh | null)[]>([]);

  // per-car runtime scratch (no per-frame allocation)
  const rt = useMemo(() => {
    const idxByDriver = new Map<number, number>();
    bundle.cars.forEach((c, i) => idxByDriver.set(c.driverNumber, i));
    const finishTime = bundle.cars.map((c) => {
      const cum = timeline.cumulative.get(c.driverNumber) ?? [];
      return c.status === 'FINISHED' ? (cum[cum.length - 1] ?? Infinity) : Infinity;
    });
    const lastLap = bundle.cars.map((c) => c.laps[c.laps.length - 1] ?? 90);
    const grid = bundle.cars.map((c, i) => c.gridPosition ?? i + 1);
    return {
      idxByDriver,
      finishTime,
      lastLap,
      grid,
      lane: new Float32Array(n),
      frac: new Float32Array(n),
      visible: new Uint8Array(n),
      order: Array.from({ length: n }, (_, i) => i),
      haloTick: 0,
      ringMats: [] as (THREE.MeshStandardMaterial[] | null)[],
      p: new THREE.Vector3(),
      t: new THREE.Vector3(),
      r: new THREE.Vector3(),
      look: new THREE.Vector3(),
      color: new THREE.Color(),
    };
  }, [bundle, timeline, n]);

  useEffect(() => {
    frame.carGroups.clear();
    groups.current.forEach((g, i) => g && frame.carGroups.set(bundle.cars[i].driverNumber, g));
    rt.ringMats = [];
    return () => frame.carGroups.clear();
  });

  const findRings = (i: number) => {
    const g = groups.current[i];
    if (!g) return null;
    const found = new Set<THREE.MeshStandardMaterial>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      // F1Car tags its compound-ring material (rings are merged, so not a TorusGeometry any more)
      if (mat && (mat.userData?.tyreRing === true || (m.geometry?.type === 'TorusGeometry' && mat.toneMapped === false))) found.add(mat);
    });
    return [...found];
  };

  useFrame((_, dt) => {
    const states = frame.states;
    if (!states.length) return;
    const L = curve.length;
    const t = frame.time;
    const ghostDn = useRaceLab.getState().ghost?.scenario.driverNumber ?? -1;

    // 1. lap fraction (with grid stagger on lap 1 and a parade after the flag)
    for (let k = 0; k < states.length; k++) {
      const s = states[k];
      const i = rt.idxByDriver.get(s.driverNumber);
      if (i === undefined) continue;
      if (s.retired) {
        rt.visible[i] = 0;
        continue;
      }
      rt.visible[i] = 1;
      let f = s.lapFraction;
      const tf = rt.finishTime[i];
      if (t >= tf) {
        const since = t - tf;
        f = Math.max(0, 0.11 * (1 - Math.exp(-since / (rt.lastLap[i] * 0.25))) - (s.position - 1) * 0.0035);
      } else if (s.lap === 1) {
        const back = ((rt.grid[i] - 1) * 0.95 + 1.2) / L;
        f = f - back * Math.max(0, 1 - f * 1.6);
      }
      rt.frac[i] = f;
    }

    // 2. physical order around the lap → keep close cars side-by-side instead of overlapping
    rt.order.sort((a, b) => rt.frac[b] - rt.frac[a]);
    for (let k = 0; k < n; k++) {
      const i = rt.order[k];
      if (!rt.visible[i]) continue;
      const s = frame.byDriver.get(bundle.cars[i].driverNumber);
      if (!s) continue;
      let target = 0;
      if (s.inPit) target = PIT_LANE_OFFSET;
      else if (ghostDn === s.driverNumber) target = -GHOST_LANE; // make room for the ghost beside reality
      else if (s.lap === 1 && t < rt.finishTime[i] && s.lapFraction < 0.06) target = (rt.grid[i] % 2 ? -0.55 : 0.55);
      else {
        // nearest visible car physically ahead
        for (let j = k - 1; j >= 0; j--) {
          const a = rt.order[j];
          if (!rt.visible[a]) continue;
          const d = (rt.frac[a] - rt.frac[i]) * L;
          if (d < 4.2) target = rt.lane[a] >= 0 ? -1.0 : 1.0;
          break;
        }
      }
      rt.lane[i] = THREE.MathUtils.damp(rt.lane[i], target, s.inPit ? 5 : 2.2, Math.min(dt, 0.1));
    }

    // 3. transforms + wakes
    for (let k = 0; k < states.length; k++) {
      const s = states[k];
      const i = rt.idxByDriver.get(s.driverNumber);
      if (i === undefined) continue;
      const g = groups.current[i];
      if (!g) continue;
      g.visible = rt.visible[i] === 1;
      if (!g.visible) continue;
      curve.pointAt(rt.frac[i], rt.p);
      curve.tangentAt(rt.frac[i], rt.t);
      rt.r.crossVectors(rt.t, UP).normalize();
      g.position.copy(rt.p).addScaledVector(rt.r, rt.lane[i]);
      g.position.y += 0.02;
      rt.look.copy(g.position).add(rt.t);
      g.lookAt(rt.look);
      g.scale.setScalar(CAR_SCALE * (1 + frame.topW * 1.1));

      const wake = wakes.current[i];
      if (wake) {
        const follower = states[k + 1];
        const live = follower && !follower.retired && !follower.finished && !s.finished && !s.inPit && t < rt.finishTime[i];
        const w = live ? wakeIntensity(follower.gapAhead) : 0;
        const m = shared.wakeMats[i];
        m.opacity = THREE.MathUtils.damp(m.opacity, w * 0.55, 6, Math.min(dt, 0.1));
        wake.visible = m.opacity > 0.01;
      }
    }

    // 4. tyre halos at ~4 Hz (compound colour fading to grey with age)
    rt.haloTick += dt;
    if (rt.haloTick > 0.25) {
      rt.haloTick = 0;
      for (const s of states) {
        const i = rt.idxByDriver.get(s.driverNumber);
        if (i === undefined) continue;
        const wear = tyreWear(s.compound, s.tyreAge);
        rt.color.set(COMPOUND_COLORS[s.compound] ?? '#ffffff').lerp(GREY, Math.pow(wear, 1.2));
        const hm = shared.haloMats[i];
        hm.color.copy(rt.color);
        hm.opacity = 0.18 + 0.42 * (1 - wear);
        const rings = rt.ringMats[i] ?? (rt.ringMats[i] = findRings(i));
        if (rings)
          for (const m of rings) {
            m.color.copy(rt.color);
            m.emissive.copy(rt.color);
            m.emissiveIntensity = 0.4 + (1 - wear * 0.85) * 2.2;
          }
      }
    }
  }, -1);

  const onClick = (dn: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    setFocus(dn);
  };

  return (
    <group>
      {bundle.cars.map((c, i) => (
        <group
          key={c.driverNumber}
          ref={(g) => (groups.current[i] = g)}
          scale={CAR_SCALE}
          visible={false}
        >
          <F1Car detail="low" color={lookup.color(c.driverNumber)} accent="#D4FF00" tyreGlow={0.8} tyreColor="#FFD400" />
          <mesh geometry={shared.haloGeo} material={shared.haloMats[i]} />
          <mesh ref={(m) => (wakes.current[i] = m)} geometry={shared.wakeGeo} material={shared.wakeMats[i]} visible={false} />
          <mesh
            geometry={shared.hitGeo}
            material={shared.hitMat}
            position={[0, 0.9, 0]}
            onClick={onClick(c.driverNumber)}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}
          />
        </group>
      ))}
      <FocusMarker />
    </group>
  );
});

/** Neon chevron + code label floating over the focus car. */
function FocusMarker() {
  const ref = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const lookup = useDriverLookup();
  const last = useRef<{ dn: number | null; pos: number }>({ dn: null, pos: 0 });

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const { focusDriver } = useRaceLab.getState();
    const car = focusDriver != null ? frame.carGroups.get(focusDriver) : undefined;
    if (!car || !car.visible || frame.chase) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.copy(car.position);
    g.position.y += 2.3 * (1 + frame.topW * 1.6) + Math.sin(clock.elapsedTime * 3) * 0.12;
    g.rotation.y = clock.elapsedTime * 1.4;
    const st = frame.byDriver.get(focusDriver!);
    if (label.current && st && (last.current.dn !== focusDriver || last.current.pos !== st.position)) {
      last.current = { dn: focusDriver, pos: st.position };
      label.current.textContent = `P${st.position} ${lookup.code(focusDriver!)}`;
    }
  });

  return (
    <group ref={ref} visible={false}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.35, 0.7, 4]} />
        <meshBasicMaterial color="#D4FF00" toneMapped={false} />
      </mesh>
      <Html center position={[0, 0.9, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={label}
          className="whitespace-nowrap rounded-sm bg-neon px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-asphalt shadow"
        />
      </Html>
    </group>
  );
}
