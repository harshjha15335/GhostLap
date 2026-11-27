import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { frame } from '../lib/frame';
import { sampleLane } from '../lib/laneTrack';
import type { RaceScene } from '../lib/raceScene';

/**
 * Trackside marshal light panels (one instanced draw call), subtle by design:
 *   SC / VSC   yellow, slow blink (VSC alternates with dark so it reads "virtual")
 *   RED        red
 *   restart    green for a short while after an SC / VSC / red period ends
 *   incident   the panels nearest a stopped car flash yellow for ~1.5 laps
 *   otherwise  dark (off)
 */
const BOARDS = 16;
const UP = new THREE.Vector3(0, 1, 0);
const OFF = new THREE.Color('#2a2f38');
const YELLOW = new THREE.Color('#FFD400');
const RED = new THREE.Color('#FF1E2D');
const GREEN = new THREE.Color('#1BE36B');

function panelGeometry() {
  const pole = new THREE.BoxGeometry(0.06, 1.2, 0.06).toNonIndexed();
  pole.translate(0, 0.6, 0);
  const frameBox = new THREE.BoxGeometry(0.7, 0.5, 0.08).toNonIndexed();
  frameBox.translate(0, 1.35, -0.01);
  const face = new THREE.PlaneGeometry(0.58, 0.38).toNonIndexed();
  face.translate(0, 1.35, 0.035);
  const pos: number[] = [];
  const col: number[] = [];
  [pole, frameBox, face].forEach((g, k) => {
    const p = g.getAttribute('position');
    const c = k === 2 ? 1 : 0.06; // only the face takes the signal colour
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c, c, c);
    }
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

export function TrackSignals({ scene }: { scene: RaceScene }) {
  const { curve, lt, plans, timeline, bundle } = scene;
  const ref = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => ({ geo: panelGeometry(), mat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }) }), []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  const rt = useMemo(() => {
    const s = new Float32Array(BOARDS);
    for (let k = 0; k < BOARDS; k++) s[k] = ((k + 0.5) / BOARDS) * lt.length;
    // ends of neutralised periods → short green
    const ends = bundle.trackStatus.map((w) => (w.endLap + 1 <= timeline.totalLaps ? timeline.timeAtLap(w.endLap + 1) : Infinity));
    const lap = lt.length > 0 ? (bundle.cars[0]?.laps[3] ?? 90) : 90;
    return { s, ends, lap, color: new THREE.Color(), dummy: new THREE.Object3D(), p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), placed: false };
  }, [lt, bundle, timeline]);

  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const sc = 1 + frame.topW * 0.6;
    for (let k = 0; k < BOARDS; k++) {
      const s = rt.s[k];
      curve.pointAt(s / lt.length, rt.p);
      curve.tangentAt(s / lt.length, rt.t);
      rt.r.crossVectors(rt.t, UP).normalize();
      const d = sampleLane(lt.lo, lt, s) - 2.0; // left verge, outside the kerb
      rt.dummy.position.copy(rt.p).addScaledVector(rt.r, d);
      rt.dummy.rotation.set(0, Math.atan2(-rt.t.x, -rt.t.z), 0); // face oncoming cars
      rt.dummy.scale.setScalar(sc);
      rt.dummy.updateMatrix();
      m.setMatrixAt(k, rt.dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;

    const t = frame.time;
    const st = frame.status;
    const e = clock.elapsedTime;
    let base = OFF;
    if (st === 'RED') base = RED;
    else if (st === 'SC') base = Math.sin(e * 5) > -0.2 ? YELLOW : OFF;
    else if (st === 'VSC') base = Math.sin(e * 3) > 0 ? YELLOW : OFF;
    else if (rt.ends.some((x) => t >= x && t < x + 25)) base = GREEN;
    for (let k = 0; k < BOARDS; k++) {
      let c = base;
      if (!st) {
        for (const p of plans) {
          if (!p || p.kind === 'garage' || t < p.tStop || t > p.tStop + p.lapTime * 1.5) continue;
          let dd = Math.abs(rt.s[k] - p.sStop);
          dd = Math.min(dd, lt.length - dd);
          if (dd < lt.length / BOARDS * 1.6) c = Math.sin(e * 10) > 0 ? YELLOW : OFF;
        }
      }
      m.setColorAt(k, rt.color.copy(c));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[res.geo, res.mat, BOARDS]} frustumCulled={false} />;
}
