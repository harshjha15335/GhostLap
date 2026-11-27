import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader, MeshoptDecoder } from 'three-stdlib';
import { CAR_SCALE, CLEAR_S, PIT_LANE_OFFSET, PIT_SPAN } from '../lib/dims';
import { frame } from '../lib/frame';
import { sampleLane } from '../lib/laneTrack';
import type { RaceScene, ScWindow } from '../lib/raceScene';

/**
 * The safety car: a low-poly road sports coupé (Kenney "Car Kit" sedan-sports, CC0 —
 * see public/models/CREDITS.md; built by scripts/models/build-safety-car.mjs, ~22 KB,
 * 1 draw call) repainted silver, with a runtime light bar (amber, flashing) and plain
 * "SAFETY CAR" lettering. No maker or sponsor logos. (In 2026 Mercedes-AMG supplies the
 * FIA safety car at every round; we keep one generic look.)
 *
 * Behaviour per SC period (lib/raceScene.ts ScWindow, laps from the data):
 *   - leaves the pit exit as the leader starts the first SC lap, then settles a couple of
 *     car lengths ahead of the leader (the field's real order / bunching comes from the
 *     timeline: the resolver keeps them single file)
 *   - on the last SC lap the lights go out and it peels into the pit lane before the line
 * 5 draw calls (body, lettering, bar, two lamps). Lazy: loaded only for races with an SC.
 */
const url = `${import.meta.env.BASE_URL}models/safety-car/safety-car.glb`;
const UP = new THREE.Vector3(0, 1, 0);
const FOLLOW_GAP = CLEAR_S * 2.3;
const JOIN_GAP_FRAC = PIT_SPAN * 0.8;
const PIT_IN_FRAC = 0.9;

function letteringTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.clearRect(0, 0, 512, 64);
    g.fillStyle = '#D4FF00';
    g.fillRect(0, 50, 512, 10);
    g.fillStyle = '#10131a';
    g.font = 'bold 44px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SAFETY CAR', 256, 27);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function letteringGeometry() {
  // one quad per flank, facing outwards (car-local, model units)
  const a = new THREE.PlaneGeometry(1.7, 0.21);
  a.rotateY(Math.PI / 2);
  a.translate(0.662, 0.42, -0.05);
  const b = new THREE.PlaneGeometry(1.7, 0.21);
  b.rotateY(-Math.PI / 2);
  b.translate(-0.662, 0.42, -0.05);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  [a, b].forEach((g, k) => {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + k * p.count);
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

export function SafetyCar({ scene }: { scene: RaceScene }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder());
  });
  const { curve, lt, sc } = scene;
  const group = useRef<THREE.Group>(null);
  const lampL = useRef<THREE.Mesh>(null);
  const lampR = useRef<THREE.Mesh>(null);

  const res = useMemo(() => {
    // keep the node transforms (meshopt quantisation stores a scale/offset on the node)
    const model = gltf.scene.clone(true);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = bodyMat;
    });
    const tex = letteringTexture();
    const letterGeo = letteringGeometry();
    const letterMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const barGeo = new THREE.BoxGeometry(0.86, 0.06, 0.16);
    const barMat = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.5 });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.09, 0.14);
    const lampMatL = new THREE.MeshBasicMaterial({ color: '#FFA000', toneMapped: false });
    const lampMatR = new THREE.MeshBasicMaterial({ color: '#FFA000', toneMapped: false });
    return { model, bodyMat, tex, letterGeo, letterMat, barGeo, barMat, lampGeo, lampMatL, lampMatR };
  }, [gltf]);

  useEffect(
    () => () => {
      res.bodyMat.dispose();
      res.tex.dispose();
      res.letterGeo.dispose();
      res.letterMat.dispose();
      res.barGeo.dispose();
      res.barMat.dispose();
      res.lampGeo.dispose();
      res.lampMatL.dispose();
      res.lampMatR.dispose();
      frame.safetyCar = null;
    },
    [res],
  );

  const rt = useMemo(
    () => ({
      p: new THREE.Vector3(),
      t: new THREE.Vector3(),
      r: new THREE.Vector3(),
      look: new THREE.Vector3(),
      lastT: NaN,
    }),
    [],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = frame.time;
    const L = lt.length;
    let w: ScWindow | null = null;
    for (const x of sc) if (t >= x.tStart && t < x.tEnd) w = x;
    const prevT = rt.lastT;
    rt.lastT = t;
    if (!w || Number.isNaN(frame.leaderS)) {
      g.visible = false;
      frame.safetyCar = null;
      return;
    }
    // deploy cue (forward playback only)
    if (!Number.isNaN(prevT) && prevT < w.tStart && t >= w.tStart && t - prevT < 40)
      frame.cue = { target: g, until: performance.now() + 5000, label: 'SAFETY CAR' };

    const lastLap = t >= w.tLastLap;
    const lapT = Math.max(20, w.tEnd - w.tLastLap);
    // gap ahead of the leader: from the pit exit down to a couple of car lengths
    const sinceStart = t - w.tStart;
    const join = Math.min(1, sinceStart / Math.max(8, lapT * 0.35));
    const joinGap = JOIN_GAP_FRAC * L;
    const gap = FOLLOW_GAP + (joinGap - FOLLOW_GAP) * (1 - join) * (1 - join);
    let s = frame.leaderS + gap;
    let d: number;
    let inPitLane = false;
    // last lap: lights off; it peels off before the line, then runs down the pit lane
    const tPitIn = w.tLastLap + Math.max(0, PIT_IN_FRAC - FOLLOW_GAP / L) * lapT;
    if (lastLap && t >= tPitIn) {
      const dist = (t - tPitIn) * (L / lapT) * 0.55;
      s = PIT_IN_FRAC * L + dist;
      inPitLane = true;
      if (dist > (1 - PIT_IN_FRAC + PIT_SPAN * 0.5) * L) {
        g.visible = false;
        frame.safetyCar = null;
        return;
      }
    }
    s = ((s % L) + L) % L;
    const f = s / L;
    // lateral: pit lane while joining / leaving, racing line otherwise
    const line = sampleLane(lt.line, lt, s);
    if (inPitLane) {
      const k = Math.min(1, (t - tPitIn) / 4);
      d = line + (PIT_LANE_OFFSET - line) * k * k * (3 - 2 * k);
    } else if (sinceStart < 30 && f < PIT_SPAN * 1.6) {
      const k = Math.min(1, Math.max(0, (f - PIT_SPAN * 0.6) / (PIT_SPAN * 0.9)));
      d = PIT_LANE_OFFSET + (line - PIT_LANE_OFFSET) * k * k * (3 - 2 * k);
    } else d = line;

    curve.pointAt(f, rt.p);
    curve.tangentAt(f, rt.t);
    rt.r.crossVectors(rt.t, UP).normalize();
    g.visible = true;
    g.position.copy(rt.p).addScaledVector(rt.r, d);
    g.position.y += 0.02;
    rt.look.copy(g.position).add(rt.t);
    g.lookAt(rt.look);
    g.scale.setScalar(1 + frame.topW * 1.1);
    frame.safetyCar = g;

    const on = !lastLap;
    const blink = Math.sin(clock.elapsedTime * 11) > 0;
    res.lampMatL.color.set(on ? (blink ? '#FFB000' : '#3a2a00') : '#2a2a2a');
    res.lampMatR.color.set(on ? (!blink ? '#FFB000' : '#3a2a00') : '#2a2a2a');
  });

  // Kenney model units → our scale: ~4.6 m long, 1.95 m wide, 1.3 m tall at CAR_SCALE
  const sx = (1.95 * CAR_SCALE) / 1.3;
  const sy = (1.3 * CAR_SCALE) / 1.1;
  const sz = (4.6 * CAR_SCALE) / 2.55;
  return (
    <group ref={group} visible={false}>
      <group scale={[sx, sy, sz]}>
        <primitive object={res.model} />
        <mesh geometry={res.letterGeo} material={res.letterMat} />
        <group position={[0, 1.0, -0.12]}>
          <mesh geometry={res.barGeo} material={res.barMat} />
          <mesh ref={lampL} geometry={res.lampGeo} material={res.lampMatL} position={[0.22, 0.06, 0]} />
          <mesh ref={lampR} geometry={res.lampGeo} material={res.lampMatR} position={[-0.22, 0.06, 0]} />
        </group>
      </group>
    </group>
  );
}
