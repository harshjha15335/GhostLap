import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LandingBus } from '../bus';
import { S_CENTER_Z } from '../layout';
import type { FlowCar } from '../stats';
import { PALETTE } from '../palette';
import { miniCarGeometry, ribbonGeometry, samplePoints } from './geometry';
import Road, { PaperGround, autoKerbs, buildFrames } from './Road';
import { trackTextTexture, wakeTexture } from './textures';

const HALF_W = 10;
const LANES = [-5, 0, 5];
const SCALE = 1.5;
const AMP = 22;
const X_SPAN = 98;
const TEXT = 'EVERY LAP · EVERY CALL · EVERY DELTA · ';
const TEXT_H = 5.5;

function buildCurve() {
  const pts: THREE.Vector3[] = [];
  for (let x = -X_SPAN; x <= X_SPAN + 0.01; x += 7) pts.push(new THREE.Vector3(x, 0, S_CENTER_Z + AMP * Math.sin((Math.PI * x) / 80)));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

interface Sim {
  s: number;
  v: number;
  base: number;
  lane: number;
  laneT: number;
  w: number;
  ph: number;
  dirty: number;
}

export default function SCurveFlow({ bus, grid }: { bus: LandingBus; grid: FlowCar[] }) {
  const root = useRef<THREE.Group>(null);
  const cars = useRef<THREE.InstancedMesh>(null);
  const wakes = useRef<THREE.InstancedMesh>(null);
  const N = 22;

  const curve = useMemo(buildCurve, []);
  const L = useMemo(() => curve.getLength(), [curve]);
  const center = useMemo(() => samplePoints(curve, 420), [curve]);

  const geo = useMemo(() => {
    const text = ribbonGeometry(center, TEXT_H, HALF_W + 7.8, 0.02);
    return { text };
  }, [center]);

  const road = useMemo(() => {
    const frames = buildFrames(center);
    return { points: center, width: HALF_W * 2, kerbs: autoKerbs(frames, 70), runoff: 2.6, runoffColor: '#2FA84F' };
  }, [center]);

  const mats = useMemo(() => {
    const textTex = trackTextTexture(TEXT, PALETTE.ink);
    textTex.flipY = false;
    textTex.repeat.set(1 / (TEXT_H * (2048 / 160)), 1);
    const wakeTex = wakeTexture();
    return {
      text: new THREE.MeshBasicMaterial({ map: textTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.95 }),
      car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35, envMapIntensity: 1.2 }),
      wake: new THREE.MeshBasicMaterial({
        alphaMap: wakeTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }),
      textTex,
      wakeTex,
    };
  }, []);
  const carGeo = useMemo(() => miniCarGeometry(), []);
  const wakeGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    g.rotateX(-Math.PI / 2); // plane +Y -> -Z (trailing behind)
    return g;
  }, []);

  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      carGeo.dispose();
      wakeGeo.dispose();
      mats.text.dispose();
      mats.car.dispose();
      mats.wake.dispose();
      mats.textTex.dispose();
      mats.wakeTex.dispose();
    },
    [geo, carGeo, wakeGeo, mats],
  );

  const sim = useMemo<Sim[]>(() => {
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: N }, (_, i) => {
      const base = 20 + r() * 7;
      return {
        s: ((i + r() * 0.5) / N) * L,
        v: base,
        base,
        lane: LANES[i % 3],
        laneT: LANES[i % 3],
        w: 0.3 + r() * 0.6,
        ph: r() * 6.28,
        dirty: 0,
      };
    });
  }, [L]);

  const colors = useMemo(() => grid.map((g) => new THREE.Color(g.color)), [grid]);
  const amber = useMemo(() => new THREE.Color('#FF7A00'), []);
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), p: new THREE.Vector3(), t: new THREE.Vector3(), c: new THREE.Color() }), []);

  useLayoutEffect(() => {
    const m = cars.current;
    if (!m) return;
    colors.forEach((c, i) => m.setColorAt(i, c));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [colors]);

  const place = (dt: number, time: number, animate: boolean) => {
    const cm = cars.current;
    const wm = wakes.current;
    if (!cm || !wm) return;
    if (animate) {
      for (let i = 0; i < N; i++) {
        const a = sim[i];
        // nearest car ahead in (roughly) the same lane
        let gap = Infinity;
        let ahead = -1;
        for (let j = 0; j < N; j++) {
          if (j === i) continue;
          const b = sim[j];
          if (Math.abs(b.lane - a.lane) > 2.6) continue;
          const d = (b.s - a.s + L) % L;
          if (d < gap) {
            gap = d;
            ahead = j;
          }
        }
        let want = a.base * (1 + 0.1 * Math.sin(time * a.w + a.ph));
        a.dirty = THREE.MathUtils.damp(a.dirty, gap < 16 ? 1 - gap / 16 : 0, 4, dt);
        if (ahead >= 0 && gap < 13) {
          const b = sim[ahead];
          if (want > b.v) {
            // look for a free lane to pass
            const free = LANES.filter((ln) => ln !== a.laneT && Math.abs(ln - a.lane) <= 5.1).find((ln) =>
              sim.every((c, k) => k === i || Math.abs(c.lane - ln) > 2.6 || Math.abs(((c.s - a.s + L * 1.5) % L) - L / 2) > 9),
            );
            if (free !== undefined && a.laneT === a.lane) a.laneT = free;
            else if (Math.abs(a.laneT - a.lane) < 0.5) want = Math.min(want, b.v - 0.5);
          }
        }
        a.v = THREE.MathUtils.damp(a.v, want, 1.5, dt);
        a.lane = THREE.MathUtils.damp(a.lane, a.laneT, 2.2, dt);
        if (Math.abs(a.lane - a.laneT) < 0.05) a.lane = a.laneT;
        a.s = (a.s + a.v * dt) % L;
      }
    }
    const { o, p, t, c } = tmp;
    for (let i = 0; i < N; i++) {
      const a = sim[i];
      const u = a.s / L;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      const yaw = Math.atan2(t.x, t.z);
      // right of travel = (-t.z, 0, t.x)
      p.x += -t.z * a.lane;
      p.z += t.x * a.lane;
      // hide near the wrap seam (off-screen anyway)
      const edge = u < 0.015 || u > 0.985 ? 0 : 1;
      o.position.set(p.x, 0.036, p.z);
      o.rotation.set(0, yaw, 0);
      o.scale.setScalar(SCALE * edge);
      o.updateMatrix();
      cm.setMatrixAt(i, o.matrix);
      const len = (6 + a.v * 0.35 + a.dirty * 8) * edge;
      o.position.set(p.x - t.x * 3.2 * SCALE * 0.5, 0.6, p.z - t.z * 3.2 * SCALE * 0.5);
      o.scale.set(1.7 * edge, 1, len);
      o.updateMatrix();
      wm.setMatrixAt(i, o.matrix);
      c.copy(colors[i] ?? amber).lerp(amber, 0.15 + a.dirty * 0.6);
      wm.setColorAt(i, c);
    }
    cm.instanceMatrix.needsUpdate = true;
    wm.instanceMatrix.needsUpdate = true;
    if (wm.instanceColor) wm.instanceColor.needsUpdate = true;
  };

  const placed = useRef(false);
  useFrame((state, dt) => {
    const s = bus.choreo.current;
    const ch = s.chapters;
    const near = bus.set === 'studio' && s.scrollY > ch[3].top - s.vh * 1.6 && s.scrollY < ch[3].top + ch[3].height + s.vh * 0.6;
    if (root.current) root.current.visible = near;
    if (!near && placed.current) return;
    const reduced = s.reducedMotion;
    place(Math.min(dt, 0.05), state.clock.elapsedTime, !reduced && near);
    placed.current = true;
    if (!reduced) mats.textTex.offset.x = (mats.textTex.offset.x - dt * 0.01) % 1;
  });

  return (
    <group ref={root}>
      <PaperGround color={PALETTE.lilac} center={[0, S_CENTER_Z]} size={[900, 700]} />
      <Road spec={road} />
      <mesh geometry={geo.text} material={mats.text} renderOrder={3} />
      <instancedMesh ref={cars} args={[carGeo, mats.car, N]} frustumCulled={false} />
      <instancedMesh ref={wakes} args={[wakeGeo, mats.wake, N]} frustumCulled={false} renderOrder={4} />
    </group>
  );
}
