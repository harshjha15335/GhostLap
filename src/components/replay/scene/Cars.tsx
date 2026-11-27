import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { F1Car, COMPOUND_COLORS } from '@/components/three/F1Car';
import { downforceLoss } from '@/engine/strategySimulator';
import { useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { CAR_LEN, CAR_SCALE } from '../lib/dims';
import { MAX_CARS, frame } from '../lib/frame';
import { tyreWear } from '../lib/raceMath';
import { createFieldCtx, createFieldOut, fillField } from '../lib/field';
import { KIND_OFF, KIND_PIT, KIND_RACE, TrafficResolver } from '../lib/traffic';
import type { RaceScene } from '../lib/raceScene';
import { createScState, scState } from '../lib/safetyCar';
import { PIT_LANE_OFFSET } from '../lib/dims';

const UP = new THREE.Vector3(0, 1, 0);
const GREY = new THREE.Color('#5b6068');
const HAZARD = new THREE.Color('#FFB000');

function makeHaloGeometry() {
  const g = new THREE.RingGeometry(1.7, 1.92, 40);
  g.rotateX(-Math.PI / 2);
  g.scale(1, 1, 1.75);
  g.translate(0, 0.03, 0);
  return g;
}

/**
 * The 22-car field. Positions come from the timeline (race truth); the lateral placement,
 * passing manoeuvres and the no-overlap guarantee come from lib/traffic.ts, retirements
 * from lib/incidents.ts. Also publishes the per-car airflow inputs (frame.air).
 * Per car: the low-LOD W17 (≤ 3 draw calls) + its tyre halo; the pick box is never drawn.
 */
export const Cars = memo(function Cars({ scene }: { scene: RaceScene }) {
  const { bundle, timeline, curve, lt, plans } = scene;
  const lookup = useDriverLookup();
  const setFocus = useRaceLab((s) => s.setFocusDriver);
  const n = bundle.cars.length;

  const shared = useMemo(() => {
    const haloGeo = makeHaloGeometry();
    const hitGeo = new THREE.BoxGeometry(3.2, 2.2, 6.5);
    // pick target only: never drawn (material.visible = false), still raycast by the click handler
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
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
    return { haloGeo, hitGeo, hitMat, haloMats };
  }, [bundle]);

  useEffect(
    () => () => {
      shared.haloGeo.dispose();
      shared.hitGeo.dispose();
      shared.hitMat.dispose();
      shared.haloMats.forEach((m) => m.dispose());
    },
    [shared],
  );

  const groups = useRef<(THREE.Group | null)[]>([]);

  // per-race runtime (no per-frame allocation)
  const rt = useMemo(() => {
    const ctx = createFieldCtx(bundle, timeline, lt, plans);
    const laps: number[] = [];
    for (const c of bundle.cars) for (let k = 1; k < c.laps.length; k++) laps.push(c.laps[k]);
    laps.sort((a, b) => a - b);
    const typical = lt.length / (laps[laps.length >> 1] || 90);
    return {
      ctx,
      // slot n = the safety car
      out: createFieldOut(n + 1),
      traffic: new TrafficResolver(lt, n + 1),
      sc: createScState(),
      lastT: NaN,
      typical,
      speed: new Float32Array(n),
      prevS: new Float64Array(n),
      haloTick: 0,
      ringMats: [] as (THREE.MeshStandardMaterial[] | null)[],
      dirs: bundle.cars.map(() => new THREE.Vector3(0, 0, 1)),
      p: new THREE.Vector3(),
      t: new THREE.Vector3(),
      r: new THREE.Vector3(),
      h: new THREE.Vector3(),
      look: new THREE.Vector3(),
      color: new THREE.Color(),
      clock: 0,
    };
  }, [bundle, timeline, lt, plans, n]);

  useEffect(() => {
    frame.carGroups.clear();
    frame.carDir.clear();
    groups.current.forEach((g, i) => {
      if (!g) return;
      frame.carGroups.set(bundle.cars[i].driverNumber, g);
      frame.carDir.set(bundle.cars[i].driverNumber, rt.dirs[i]);
    });
    rt.ringMats = [];
    return () => {
      frame.carGroups.clear();
      frame.carDir.clear();
      frame.battling.clear();
    };
  });

  const findRings = (i: number) => {
    const g = groups.current[i];
    if (!g) return null;
    const found = new Set<THREE.MeshStandardMaterial>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      // F1Car tags its compound-ring material (W17 low LOD: the "rings" mesh)
      if (mat && mat.userData?.tyreRing === true) found.add(mat);
    });
    // the model streams in after mount: don't cache "no rings yet"
    return found.size ? [...found] : null;
  };

  useFrame((_, rawDt) => {
    const states = frame.states;
    if (!states.length) return;
    const dt = Math.min(rawDt, 0.1);
    rt.clock += dt;
    const L = lt.length;
    const t = frame.time;
    const lab = useRaceLab.getState();
    const ghostDn = lab.ghost?.scenario.driverNumber ?? -1;
    const out = rt.out;
    const tr = rt.traffic;

    // 1. timeline → resolver input; 2. resolve (only when the race clock moved)
    fillField(rt.ctx, states, t, ghostDn, frame.status, out);
    // the safety car runs in the same resolver (ahead of last frame's leader)
    const sc = scState(scene.sc, t, frame.leaderS, L, rt.sc);
    out.input.kind[n] = sc.on ? (sc.pit ? KIND_PIT : KIND_RACE) : KIND_OFF;
    out.input.sTrue[n] = sc.s;
    out.input.prefD[n] = sc.pit ? PIT_LANE_OFFSET : NaN;
    const dRace = t - rt.lastT;
    if (dRace !== 0 || Number.isNaN(rt.lastT)) {
      tr.step(out.input, Number.isNaN(rt.lastT) ? -1 : dRace);
      for (let i = 0; i < n; i++) {
        // after a seek there is no history: assume a typical pace (slower when neutralised / pitting)
        const guess = rt.typical * (out.input.kind[i] === KIND_PIT ? 0.3 : frame.status ? 0.6 : 1);
        const v = tr.resetLast ? guess : dRace <= 0 ? rt.speed[i] : Math.abs(tr.diff(rt.prevS[i], tr.sv[i])) / dRace;
        rt.speed[i] += (v - rt.speed[i]) * (tr.resetLast ? 1 : 0.35);
        rt.prevS[i] = tr.sv[i];
      }
      rt.lastT = t;
    }

    const scp = frame.scPose;
    scp.on = sc.on;
    scp.s = tr.sv[n];
    scp.d = tr.d[n];
    scp.yaw = tr.yaw[n];
    scp.lights = sc.lights;

    frame.leaderS = NaN;
    for (let k = 0; k < states.length; k++) {
      const s0 = states[k];
      if (s0.retired) break;
      const i0 = rt.ctx.idxByDriver.get(s0.driverNumber);
      if (i0 !== undefined && out.input.kind[i0] !== KIND_OFF && !out.posed[i0]) {
        frame.leaderS = out.input.sTrue[i0];
        break;
      }
    }

    // 3. transforms
    const scale = CAR_SCALE * (1 + frame.topW * 1.1);
    const air = frame.air;
    air.count = Math.min(n, MAX_CARS);
    air.scale = 1 + frame.topW * 1.1;
    frame.battling.clear();
    for (let i = 0; i < n; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const hidden = out.hidden[i] === 1 || (out.input.kind[i] === KIND_OFF && out.posed[i] !== 1);
      g.visible = !hidden;
      if (i < MAX_CARS) air.weight[i] = 0;
      if (hidden) continue;
      let s: number, d: number, yaw: number;
      if (out.posed[i]) {
        const pose = out.poses[i];
        s = pose.s;
        d = pose.d;
        yaw = pose.yaw;
      } else {
        s = tr.sv[i];
        d = tr.d[i];
        yaw = tr.yaw[i];
      }
      const f = s / L;
      curve.pointAt(f, rt.p);
      curve.tangentAt(f, rt.t);
      rt.r.crossVectors(rt.t, UP).normalize();
      rt.dirs[i].copy(rt.t);
      g.position.copy(rt.p).addScaledVector(rt.r, d);
      g.position.y += 0.02;
      // heading: tangent turned by the lateral-motion / spin yaw (+ = towards the right)
      rt.h.copy(rt.t).multiplyScalar(Math.cos(yaw)).addScaledVector(rt.r, Math.sin(yaw));
      rt.look.copy(g.position).add(rt.h);
      g.lookAt(rt.look);
      g.scale.setScalar(scale);
      if (tr.alongside[i] && !out.posed[i]) frame.battling.add(bundle.cars[i].driverNumber);

      if (i < MAX_CARS) {
        air.pos[i * 3] = g.position.x;
        air.pos[i * 3 + 1] = g.position.y;
        air.pos[i * 3 + 2] = g.position.z;
        air.yaw[i] = Math.atan2(rt.h.x, rt.h.z);
        const sp = out.posed[i] ? out.poses[i].speed : rt.speed[i];
        air.speed[i] = Math.min(1.2, sp / rt.typical);
        air.s[i] = s;
        air.d[i] = d;
        air.loss[i] = 0;
        air.follow[i] = 0;
        air.weight[i] = out.input.kind[i] === KIND_RACE ? 0.35 : 0;
      }
    }

    // 4. airflow: who is in whose wake (timeline running order, physically close), focus weighting
    const focus = lab.focusDriver;
    let focusPos = -1;
    for (let k = 0; k < states.length; k++) if (states[k].driverNumber === focus) focusPos = k;
    for (let k = 0; k < states.length; k++) {
      const s = states[k];
      const i = rt.ctx.idxByDriver.get(s.driverNumber);
      if (i === undefined || i >= MAX_CARS || air.weight[i] === 0) continue;
      if (focusPos >= 0 && Math.abs(k - focusPos) <= 3) air.weight[i] = 1;
      const fol = states[k + 1];
      if (!fol || fol.retired || fol.inPit || s.finished) continue;
      const j = rt.ctx.idxByDriver.get(fol.driverNumber);
      if (j === undefined || out.input.kind[j] !== KIND_RACE) continue;
      const dist = tr.diff(tr.sv[j], tr.sv[i]);
      if (dist <= 0 || dist > 14) continue;
      air.loss[i] = downforceLoss(fol.gapAhead);
      air.follow[i] = Math.max(0.1, dist - CAR_LEN * 0.5);
    }

    // 5. tyre halos at ~4 Hz (compound colour fading to grey with age); parked cars flash hazards
    rt.haloTick += dt;
    const blink = Math.sin(rt.clock * 9) > 0;
    for (let i = 0; i < n; i++) {
      if (!out.posed[i] || out.input.kind[i] === KIND_OFF) continue;
      const hm = shared.haloMats[i];
      hm.color.copy(HAZARD);
      hm.opacity = blink ? 0.85 : 0.12;
    }
    if (rt.haloTick > 0.25) {
      rt.haloTick = 0;
      for (const s of states) {
        const i = rt.ctx.idxByDriver.get(s.driverNumber);
        if (i === undefined || out.posed[i]) continue;
        const wear = tyreWear(s.compound, s.tyreAge);
        rt.color.set(COMPOUND_COLORS[s.compound] ?? '#ffffff').lerp(GREY, Math.pow(wear, 1.2));
        const hm = shared.haloMats[i];
        hm.color.copy(rt.color);
        hm.opacity = 0.18 + 0.42 * (1 - wear);
        const rings = rt.ringMats[i] || (rt.ringMats[i] = findRings(i));
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
        <group key={c.driverNumber} ref={(g) => (groups.current[i] = g)} scale={CAR_SCALE} visible={false}>
          <F1Car detail="low" teamId={lookup.driver(c.driverNumber)?.teamId} color={lookup.color(c.driverNumber)} accent="#D4FF00" tyreGlow={0.8} tyreColor="#FFD400" />
          <mesh geometry={shared.haloGeo} material={shared.haloMats[i]} />
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
      label.current.textContent = st.retired ? `OUT ${lookup.code(focusDriver!)}` : `P${st.position} ${lookup.code(focusDriver!)}`;
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
          className="whitespace-nowrap rounded-[4px] border-2 border-ink bg-neon px-1.5 py-0.5 font-mono text-[11px] font-bold leading-none text-ink shadow-sticker-sm"
        />
      </Html>
    </group>
  );
}
