import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useDriverLookup } from '@/store/seasonStore';
import { CAR_SCALE } from '../lib/dims';
import { frame } from '../lib/frame';
import { retirePose, SLIDE_SECONDS, type RetirePose } from '../lib/incidents';
import { sampleLane } from '../lib/laneTrack';
import type { RaceScene } from '../lib/raceScene';

/**
 * Incident dressing for retirements staged by lib/incidents.ts (the cars themselves are
 * posed by Cars.tsx and stay parked): instanced carbon / livery debris for crashes
 * (1 draw call) and marshal posts with waving yellow flags at every stopped car
 * (1 draw call). Also raises a director cue so the camera can cut to the incident.
 */
const PIECES = 12;
const UP = new THREE.Vector3(0, 1, 0);

function flagGeometry() {
  // pole (dark) + flag (white → tinted yellow by the instance colour)
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5).toNonIndexed();
  pole.translate(0, 0.75, 0);
  const flag = new THREE.PlaneGeometry(0.65, 0.45, 4, 1).toNonIndexed();
  flag.translate(0.33, 1.25, 0);
  const merge = (gs: THREE.BufferGeometry[], cols: number[]) => {
    const pos: number[] = [];
    const col: number[] = [];
    gs.forEach((g, k) => {
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        col.push(cols[k], cols[k], cols[k]);
      }
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  };
  return merge([pole, flag], [0.12, 1]);
}

export function Incidents({ scene }: { scene: RaceScene }) {
  const { curve, lt, plans } = scene;
  const lookup = useDriverLookup();
  const debris = useRef<THREE.InstancedMesh>(null);
  const flags = useRef<THREE.InstancedMesh>(null);

  const list = useMemo(
    () =>
      plans
        .map((p, i) => (p && p.kind !== 'garage' ? { plan: p, idx: i } : null))
        .filter((x): x is NonNullable<typeof x> => !!x),
    [plans],
  );
  const crashes = useMemo(() => list.filter((x) => x.plan.kind === 'crash'), [list]);

  const res = useMemo(() => {
    const debrisGeo = new THREE.BoxGeometry(0.34, 0.06, 0.22);
    const debrisMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
    const flagGeo = flagGeometry();
    const flagMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    return { debrisGeo, debrisMat, flagGeo, flagMat };
  }, []);
  useEffect(
    () => () => {
      res.debrisGeo.dispose();
      res.debrisMat.dispose();
      res.flagGeo.dispose();
      res.flagMat.dispose();
    },
    [res],
  );

  const rt = useMemo(() => {
    const rnd = (seed: number, k: number) => {
      const x = Math.sin(seed * 0.0001 + k * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    // per piece: forward throw, lateral throw, up velocity, spin, colour (carbon vs livery)
    const pieces = crashes.map(({ plan }) =>
      Array.from({ length: PIECES }, (_, k) => ({
        fwd: 0.6 + rnd(plan.seed, k) * 3.2,
        lat: (rnd(plan.seed, k + 40) - 0.5) * 2.4,
        up: 1.5 + rnd(plan.seed, k + 80) * 2.5,
        spin: (rnd(plan.seed, k + 120) - 0.5) * 14,
        delay: rnd(plan.seed, k + 160) * 0.6,
        livery: k % 3 === 0,
      })),
    );
    return {
      pieces,
      pose: { s: 0, d: 0, yaw: 0, phase: 0, since: 0, speed: 0 } as RetirePose,
      dummy: new THREE.Object3D(),
      p: new THREE.Vector3(),
      t: new THREE.Vector3(),
      r: new THREE.Vector3(),
      color: new THREE.Color(),
      lastT: NaN,
    };
  }, [crashes]);

  // instance colours: carbon black + the team colour
  useEffect(() => {
    const m = debris.current;
    if (!m) return;
    crashes.forEach(({ plan }, c) =>
      rt.pieces[c].forEach((pc, k) => m.setColorAt(c * PIECES + k, rt.color.set(pc.livery ? lookup.color(plan.driverNumber) : '#1b1e24'))),
    );
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const f = flags.current;
    if (f) {
      for (let k = 0; k < list.length * 2; k++) f.setColorAt(k, rt.color.set('#FFD400'));
      if (f.instanceColor) f.instanceColor.needsUpdate = true;
    }
  }, [crashes, list, lookup, rt]);

  const place = (s: number, d: number) => {
    curve.pointAt(s / lt.length, rt.p);
    curve.tangentAt(s / lt.length, rt.t);
    rt.r.crossVectors(rt.t, UP).normalize();
    return rt.p.addScaledVector(rt.r, d);
  };

  useFrame(({ clock }) => {
    const t = frame.time;
    const sc = 1 + frame.topW * 1.1;
    const dm = rt.dummy;

    // director cue when an incident starts during forward playback
    if (!Number.isNaN(rt.lastT) && t > rt.lastT && t - rt.lastT < 40) {
      for (const { plan } of list) {
        if (rt.lastT < plan.tStop && t >= plan.tStop) {
          const g = frame.carGroups.get(plan.driverNumber);
          if (g) frame.cue = { target: g, until: performance.now() + 4500, label: `${lookup.code(plan.driverNumber)} ${plan.kind === 'crash' ? 'CRASH' : 'STOPPED'}` };
        }
      }
    }
    rt.lastT = t;

    const dbm = debris.current;
    if (dbm) {
      crashes.forEach(({ plan }, c) => {
        const tau = t - plan.tStop;
        for (let k = 0; k < PIECES; k++) {
          const pc = rt.pieces[c][k];
          const tk = Math.min(tau, SLIDE_SECONDS + 2) - pc.delay;
          if (t < plan.tStop || tk < 0) {
            dm.scale.setScalar(0);
          } else {
            const pose = retirePose(plan, plan.tStop + pc.delay, lt, rt.pose);
            const fly = 1 - Math.exp(-tk / 0.5);
            const s = pose.s + pc.fwd * 1.6 * fly;
            const d = pose.d + pc.lat * fly + plan.side * 0.4 * fly;
            place(s, d);
            const air = Math.max(0, pc.up * tk - 4.9 * tk * tk) * 0.35;
            dm.position.copy(rt.p);
            dm.position.y += 0.04 + air;
            const spin = pc.spin * (1 - Math.exp(-tk / 0.7));
            dm.rotation.set(air > 0 ? spin : 0, spin * 0.7, air > 0 ? spin * 0.4 : 0);
            dm.scale.setScalar(sc * (pc.livery ? 1.2 : 0.9));
          }
          dm.updateMatrix();
          dbm.setMatrixAt(c * PIECES + k, dm.matrix);
        }
      });
      dbm.instanceMatrix.needsUpdate = true;
    }

    const fm = flags.current;
    if (fm) {
      list.forEach(({ plan }, c) => {
        const on = t >= plan.tStop && t < plan.tStop + plan.lapTime * 1.6;
        const rest = retirePose(plan, plan.tStop + SLIDE_SECONDS, lt, rt.pose);
        for (let k = 0; k < 2; k++) {
          if (!on) dm.scale.setScalar(0);
          else {
            const s = rest.s + (k === 0 ? -4.5 : 3.5);
            const edge = plan.side > 0 ? sampleLane(lt.hi, lt, s) + 3.0 : sampleLane(lt.lo, lt, s) - 3.0;
            place(s, edge);
            dm.position.copy(rt.p);
            // face the oncoming traffic, waving
            dm.rotation.set(0, Math.atan2(-rt.t.x, -rt.t.z) + Math.sin(clock.elapsedTime * 7 + k * 2) * 0.6, 0);
            dm.scale.setScalar(sc * CAR_SCALE * 1.8);
          }
          dm.updateMatrix();
          fm.setMatrixAt(c * 2 + k, dm.matrix);
        }
      });
      fm.instanceMatrix.needsUpdate = true;
    }
  });

  if (!list.length) return null;
  return (
    <>
      {crashes.length > 0 && (
        <instancedMesh ref={debris} args={[res.debrisGeo, res.debrisMat, crashes.length * PIECES]} frustumCulled={false} />
      )}
      <instancedMesh ref={flags} args={[res.flagGeo, res.flagMat, list.length * 2]} frustumCulled={false} />
    </>
  );
}
