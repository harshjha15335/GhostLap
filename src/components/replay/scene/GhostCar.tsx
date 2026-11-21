import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { GhostResult, RaceBundle } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';
import { F1Car } from '@/components/three/F1Car';
import { useRaceLab } from '@/store/raceLabStore';
import { CAR_SCALE, GHOST_LANE, PIT_LANE_OFFSET, frame } from '../lib/frame';

const UP = new THREE.Vector3(0, 1, 0);
const CYAN = new THREE.Color('#00F5D4');
const SEG = 64;
const TRAIL_LEN = 22; // render units

export function GhostCar({ bundle, curve }: { bundle: RaceBundle; curve: CircuitCurve }) {
  const ghost = useRaceLab((s) => s.ghost);
  if (!ghost) return null;
  return <GhostInner key={ghost.totalTime + ':' + ghost.scenario.driverNumber} bundle={bundle} curve={curve} ghost={ghost} />;
}

function GhostInner({ bundle, curve, ghost }: { bundle: RaceBundle; curve: CircuitCurve; ghost: GhostResult }) {
  const group = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLDivElement>(null);

  const info = useMemo(() => {
    const car = bundle.cars.find((c) => c.driverNumber === ghost.scenario.driverNumber);
    const pits = new Set<number>(ghost.scenario.stops.map((s) => s.lap));
    car?.pits.forEach((p) => p.lap < ghost.scenario.fromLap && pits.add(p.lap));
    return { pits, grid: car?.gridPosition ?? 1, lastLap: ghost.laps[ghost.laps.length - 1] ?? 90 };
  }, [bundle, ghost]);

  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((SEG + 1) * 2 * 3);
    const col = new Float32Array((SEG + 1) * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = Math.pow(1 - i / SEG, 1.5);
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * 4;
        col[o] = CYAN.r;
        col[o + 1] = CYAN.g;
        col[o + 2] = CYAN.b;
        col[o + 3] = a * 0.85;
      }
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    return g;
  }, []);
  const trailMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      trailGeo.dispose();
      trailMat.dispose();
      frame.ghostGroup = null;
    },
    [trailGeo, trailMat],
  );

  const rt = useMemo(
    () => ({ lane: GHOST_LANE, p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), look: new THREE.Vector3(), lastPos: 0 }),
    [],
  );

  useFrame((_, dt) => {
    const g = group.current;
    const gp = frame.ghost;
    if (!g || !gp) return;
    frame.ghostGroup = g;
    const t = frame.time;
    const L = curve.length;
    let f = gp.lapFraction;
    if (t >= ghost.totalTime) {
      f = Math.max(0, 0.11 * (1 - Math.exp(-(t - ghost.totalTime) / (info.lastLap * 0.25))) - (ghost.ghostFinishPosition - 1) * 0.0035);
    } else if (gp.lap === 1) {
      const back = ((info.grid - 1) * 0.95 + 1.2) / L;
      f -= back * Math.max(0, 1 - f * 1.6);
    }
    const inPit =
      t < ghost.totalTime &&
      ((info.pits.has(gp.lap) && gp.lapFraction > 0.93) || (info.pits.has(gp.lap - 1) && gp.lapFraction < 0.07));
    rt.lane = THREE.MathUtils.damp(rt.lane, inPit ? PIT_LANE_OFFSET : GHOST_LANE, 5, Math.min(dt, 0.1));

    curve.pointAt(f, rt.p);
    curve.tangentAt(f, rt.t);
    rt.r.crossVectors(rt.t, UP).normalize();
    g.position.copy(rt.p).addScaledVector(rt.r, rt.lane);
    g.position.y += 0.05;
    rt.look.copy(g.position).add(rt.t);
    g.lookAt(rt.look);

    // trail ribbon: sampled back along the spline (stable when scrubbing)
    const pos = trailGeo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i <= SEG; i++) {
      const fi = f - ((i / SEG) * TRAIL_LEN + 1.2) / L;
      curve.pointAt(fi, rt.p);
      curve.tangentAt(fi, rt.t);
      rt.r.crossVectors(rt.t, UP).normalize();
      const w = 0.42 * (1 - i / SEG) + 0.04;
      const cx = rt.p.x + rt.r.x * rt.lane;
      const cz = rt.p.z + rt.r.z * rt.lane;
      const y = rt.p.y + 0.06;
      const o = i * 6;
      arr[o] = cx - rt.r.x * w;
      arr[o + 1] = y;
      arr[o + 2] = cz - rt.r.z * w;
      arr[o + 3] = cx + rt.r.x * w;
      arr[o + 4] = y;
      arr[o + 5] = cz + rt.r.z * w;
    }
    pos.needsUpdate = true;

    const p = ghost.positionByLap[Math.min(ghost.positionByLap.length - 1, Math.max(0, gp.lap - 2))] ?? ghost.ghostFinishPosition;
    if (label.current && p !== rt.lastPos) {
      rt.lastPos = p;
      label.current.textContent = `GHOST · P${p}`;
    }
  }, -1);

  return (
    <>
      <group ref={group}>
        <F1Car ghost detail="low" scale={CAR_SCALE} />
        <Html center position={[0, 2.6, 0]} zIndexRange={[19, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={label}
            className="whitespace-nowrap rounded-sm border border-ghost/70 bg-asphalt/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-ghost shadow-[0_0_12px_rgba(0,245,212,.6)]"
          >
            GHOST
          </div>
        </Html>
      </group>
      <mesh ref={trail} geometry={trailGeo} material={trailMat} frustumCulled={false} />
    </>
  );
}
