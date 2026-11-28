import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { TrackStatusType } from '@/types';
import { frame } from '../lib/frame';
import { sampleLane } from '../lib/laneTrack';
import type { RaceScene } from '../lib/raceScene';

/**
 * Trackside marshal LED boards: 2 instanced draw calls (housings + lit faces).
 *   VSC        bright yellow "VSC" boards, flashing, all round the lap
 *   SC         yellow "SC" boards, steady blink
 *   RED        red boards
 *   restart    green for a short while after an SC / VSC / red period ends
 *   incident   the boards nearest a stopped car flash yellow for ~1.5 laps
 *   otherwise  dark (off)
 * The face texture (dot-matrix glyphs) is swapped per track state: one texture per
 * label, made once on a canvas. Faces face the oncoming cars from the left verge.
 */
const BOARDS = 24;
const UP = new THREE.Vector3(0, 1, 0);
const OFF = new THREE.Color('#1f232b');
const YELLOW = new THREE.Color('#FFE14D').multiplyScalar(1.6);
const RED = new THREE.Color('#FF2A36').multiplyScalar(1.4);
const GREEN = new THREE.Color('#2BFF7E').multiplyScalar(1.4);
const GREEN_SECONDS = 25;
/** the VSC boards' dim phase still shows the label (it must read in any frame) */
const YELLOW_DIM = new THREE.Color('#FFE14D').multiplyScalar(0.45);
/** boards are drawn larger than life so they read from the broadcast camera */
const BOARD_SCALE = 1.6;

function housingGeometry() {
  const pole = new THREE.BoxGeometry(0.07, 1.25, 0.07).toNonIndexed();
  pole.translate(0, 0.62, 0);
  const box = new THREE.BoxGeometry(1.18, 0.62, 0.1).toNonIndexed();
  box.translate(0, 1.5, -0.03);
  const pos: number[] = [];
  const col: number[] = [];
  [pole, box].forEach((g) => {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(0.07, 0.07, 0.08);
    }
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function faceGeometry() {
  const g = new THREE.PlaneGeometry(1.06, 0.5);
  g.translate(0, 1.5, 0.03);
  return g;
}

/** dot-matrix LED face: lit dots form the label, the rest glow faintly */
function ledTexture(label: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 128;
  const H = 60;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  // the glyph mask
  const m = document.createElement('canvas');
  m.width = W / 4;
  m.height = H / 4;
  const mg = m.getContext('2d')!;
  mg.fillStyle = '#000';
  mg.fillRect(0, 0, m.width, m.height);
  if (label) {
    mg.fillStyle = '#fff';
    mg.font = `bold ${label.length > 2 ? 12 : 13}px sans-serif`;
    mg.textAlign = 'center';
    mg.textBaseline = 'middle';
    mg.fillText(label, m.width / 2, m.height / 2 + 1);
  }
  const mask = mg.getImageData(0, 0, m.width, m.height).data;
  g.fillStyle = '#060606';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const on = label ? mask[(y * m.width + x) * 4] > 90 : true;
      g.fillStyle = on ? '#ffffff' : '#2a2a2a';
      g.beginPath();
      g.arc(x * 4 + 2, y * 4 + 2, 1.55, 0, Math.PI * 2);
      g.fill();
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

type Face = 'VSC' | 'SC' | 'RED' | 'FULL';

export function TrackSignals({ scene }: { scene: RaceScene }) {
  const { curve, lt, plans, timeline, bundle } = scene;
  const housing = useRef<THREE.InstancedMesh>(null);
  const faces = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const tex: Record<Face, THREE.CanvasTexture | null> = {
      VSC: ledTexture('VSC'),
      SC: ledTexture('SC'),
      RED: ledTexture(''),
      FULL: ledTexture(''),
    };
    return {
      hGeo: housingGeometry(),
      hMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
      fGeo: faceGeometry(),
      fMat: new THREE.MeshBasicMaterial({ map: tex.FULL, toneMapped: false }),
      tex,
    };
  }, []);
  useEffect(
    () => () => {
      res.hGeo.dispose();
      res.hMat.dispose();
      res.fGeo.dispose();
      res.fMat.dispose();
      Object.values(res.tex).forEach((t) => t?.dispose());
    },
    [res],
  );

  const rt = useMemo(() => {
    const s = new Float32Array(BOARDS);
    for (let k = 0; k < BOARDS; k++) s[k] = ((k + 0.5) / BOARDS) * lt.length;
    // ends of neutralised periods → short green
    const ends = bundle.trackStatus.map((w) => (w.endLap + 1 <= timeline.totalLaps ? timeline.timeAtLap(w.endLap + 1) : Infinity));
    const restS = plans.map((p) => (p ? (((p.sRest % lt.length) + lt.length) % lt.length) : 0));
    return { s, ends, restS, color: new THREE.Color(), dummy: new THREE.Object3D(), p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), lastScale: -1, face: 'FULL' as Face };
  }, [lt, bundle, timeline, plans]);

  useFrame(({ clock }) => {
    const hm = housing.current;
    const fm = faces.current;
    if (!hm || !fm) return;
    const sc = BOARD_SCALE * (1 + frame.topW * 0.6);
    if (sc !== rt.lastScale) {
      rt.lastScale = sc;
      for (let k = 0; k < BOARDS; k++) {
        const s = rt.s[k];
        curve.pointAt(s / lt.length, rt.p);
        curve.tangentAt(s / lt.length, rt.t);
        rt.r.crossVectors(rt.t, UP).normalize();
        const d = sampleLane(lt.lo, lt, s) - 2.4; // left verge, outside the kerb
        rt.dummy.position.copy(rt.p).addScaledVector(rt.r, d);
        rt.dummy.rotation.set(0, Math.atan2(-rt.t.x, -rt.t.z), 0); // face oncoming cars
        rt.dummy.scale.setScalar(sc);
        rt.dummy.updateMatrix();
        hm.setMatrixAt(k, rt.dummy.matrix);
        fm.setMatrixAt(k, rt.dummy.matrix);
      }
      hm.instanceMatrix.needsUpdate = true;
      fm.instanceMatrix.needsUpdate = true;
    }

    const t = frame.time;
    const st: TrackStatusType | null = frame.status;
    const e = clock.elapsedTime;
    let green = false;
    for (let k = 0; k < rt.ends.length; k++) if (t >= rt.ends[k] && t < rt.ends[k] + GREEN_SECONDS) green = true;
    let base = OFF;
    let face: Face = 'FULL';
    if (st === 'RED') {
      base = RED;
      face = 'RED';
    } else if (st === 'SC') {
      base = Math.sin(e * 5) > -0.3 ? YELLOW : OFF;
      face = 'SC';
    } else if (st === 'VSC') {
      // VSC: bright, flashing ~1.5 Hz, the label readable while lit
      base = Math.sin(e * 9.4) > -0.35 ? YELLOW : YELLOW_DIM;
      face = 'VSC';
    } else if (green) base = GREEN;
    if (face !== rt.face) {
      rt.face = face;
      res.fMat.map = res.tex[face];
      res.fMat.needsUpdate = true;
    }
    for (let k = 0; k < BOARDS; k++) {
      let c = base;
      if (!st) {
        for (let q = 0; q < plans.length; q++) {
          const p = plans[q];
          if (!p || p.kind === 'garage' || t < p.tStop || t > p.tStop + p.lapTime * 1.5) continue;
          let dd = Math.abs(rt.s[k] - rt.restS[q]);
          dd = Math.min(dd, lt.length - dd);
          if (dd < (lt.length / BOARDS) * 1.6) c = Math.sin(e * 10) > 0 ? YELLOW : OFF;
        }
      }
      fm.setColorAt(k, rt.color.copy(c));
    }
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={housing} args={[res.hGeo, res.hMat, BOARDS]} frustumCulled={false} />
      <instancedMesh ref={faces} args={[res.fGeo, res.fMat, BOARDS]} frustumCulled={false} />
    </>
  );
}
