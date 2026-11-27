import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader, MeshoptDecoder } from 'three-stdlib';
import { CAR_SCALE } from '../lib/dims';
import { frame } from '../lib/frame';
import type { RaceScene } from '../lib/raceScene';

/**
 * The safety car: a low-poly road sports coupé (Kenney "Car Kit" sedan-sports, CC0 —
 * see public/models/CREDITS.md; built by scripts/models/build-safety-car.mjs, ~22 KB,
 * 1 draw call) repainted silver, with a runtime light bar (amber, flashing) and plain
 * "SAFETY CAR" lettering. No maker or sponsor logos. (In 2026 Mercedes-AMG supplies the
 * FIA safety car at every round; we keep one generic look.)
 *
 * Behaviour per SC period (lib/safetyCar.ts; laps from the data): it leaves the pit exit
 * as the leader starts the first SC lap, settles a couple of car lengths ahead of the
 * leader (the field's real order and bunching come from the timeline; the resolver keeps
 * everyone single file and never lets the SC overlap a car — it runs in the resolver as
 * one more car), and on the last SC lap turns its lights off and peels into the pit lane.
 * 5 draw calls (body, lettering, bar, two lamps). Lazy: loaded only for races with an SC.
 */
const url = `${import.meta.env.BASE_URL}models/safety-car/safety-car.glb`;
const UP = new THREE.Vector3(0, 1, 0);

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
  // one quad per flank (facing outwards) + one on the roof (reads from the TV cameras above)
  const a = new THREE.PlaneGeometry(1.9, 0.3);
  a.rotateY(Math.PI / 2);
  a.translate(0.656, 0.5, -0.05);
  const b = new THREE.PlaneGeometry(1.9, 0.3);
  b.rotateY(-Math.PI / 2);
  b.translate(-0.656, 0.5, -0.05);
  const c = new THREE.PlaneGeometry(0.85, 0.14);
  c.rotateX(-Math.PI / 2);
  c.rotateY(Math.PI / 2);
  c.translate(0, 1.104, 0.12);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  [a, b, c].forEach((g) => {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
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
    const letterMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
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
      h: new THREE.Vector3(),
      lastT: NaN,
    }),
    [],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = frame.time;
    const pose = frame.scPose;
    const prevT = rt.lastT;
    rt.lastT = t;
    if (!pose.on) {
      g.visible = false;
      frame.safetyCar = null;
      return;
    }
    // deploy cue (forward playback only)
    for (const w of sc)
      if (!Number.isNaN(prevT) && prevT < w.tStart && t >= w.tStart && t - prevT < 40)
        frame.cue = { target: g, until: performance.now() + 5000, label: 'SAFETY CAR' };

    const f = pose.s / lt.length;
    curve.pointAt(f, rt.p);
    curve.tangentAt(f, rt.t);
    rt.r.crossVectors(rt.t, UP).normalize();
    g.visible = true;
    g.position.copy(rt.p).addScaledVector(rt.r, pose.d);
    g.position.y += 0.02;
    rt.h.copy(rt.t).multiplyScalar(Math.cos(pose.yaw)).addScaledVector(rt.r, Math.sin(pose.yaw));
    rt.look.copy(g.position).add(rt.h);
    g.lookAt(rt.look);
    g.scale.setScalar(1 + frame.topW * 1.1);
    frame.safetyCar = g;

    const blink = Math.sin(clock.elapsedTime * 11) > 0;
    res.lampMatL.color.set(pose.lights ? (blink ? '#FFB000' : '#3a2a00') : '#2a2a2a');
    res.lampMatR.color.set(pose.lights ? (!blink ? '#FFB000' : '#3a2a00') : '#2a2a2a');
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
        <group position={[0, 1.13, -0.28]}>
          <mesh geometry={res.barGeo} material={res.barMat} />
          <mesh ref={lampL} geometry={res.lampGeo} material={res.lampMatL} position={[0.22, 0.06, 0]} />
          <mesh ref={lampR} geometry={res.lampGeo} material={res.lampMatR} position={[-0.22, 0.06, 0]} />
        </group>
      </group>
    </group>
  );
}
