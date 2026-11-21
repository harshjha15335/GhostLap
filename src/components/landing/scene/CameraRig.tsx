import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { smooth01 } from '@/hooks/useScrollChoreography';
import type { LandingBus } from '../bus';
import { DRIVE_LEN, FOV, S_CENTER_Z, U_CENTER_Z, driveCamZ, pathX, type LandingLayout } from '../layout';

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  focus: THREE.Vector3;
  fog: number;
}

const mkPose = (): Pose => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), focus: new THREE.Vector3(), fog: 0.01 });

/** [before, after] blend window around each chapter boundary, in viewport heights. */
const WINDOWS: [number, number][] = [
  [0, 0],
  [0.55, 0.45],
  [0.25, 0.9], // 'after' is overridden by layout.rotatePx (top-down rotation phase)
  [0.55, 0.5],
  [0.55, 0.5],
  [0.7, 0.25],
];

const UP = new THREE.Vector3(0, 1, 0);
const DOWN_UP = new THREE.Vector3(0, 0, -1);
const PORTRAIT_UP = new THREE.Vector3(1, 0, 0);
const m4 = new THREE.Matrix4();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const eye = new THREE.Vector3();
const tgt = new THREE.Vector3();

function look(out: Pose, e: THREE.Vector3, t: THREE.Vector3, up = UP) {
  out.pos.copy(e);
  m4.lookAt(e, t, up);
  out.quat.setFromRotationMatrix(m4);
  out.focus.copy(t);
}

/** pan eye+target sideways (camera-right) and return */
function pan(e: THREE.Vector3, t: THREE.Vector3, amount: number) {
  fwd.subVectors(t, e).normalize();
  right.crossVectors(fwd, UP).normalize();
  e.addScaledVector(right, amount);
  t.addScaledVector(right, amount);
}

interface Ctx {
  layout: LandingLayout;
  scrollY: number;
  driveTop: number;
  aspect: number;
  time: number;
  px: number;
  py: number;
}

const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);

function evalChapter(k: number, t: number, c: Ctx, out: Pose) {
  const L = c.layout;
  const mobile = L.mobile || c.aspect < 0.9;
  switch (k) {
    case 0: {
      // low 3/4 front hero shot, slow idle orbit
      const a = -0.62 - 0.32 * t + Math.sin(c.time * 0.12) * 0.06 + c.px * 0.05;
      const r = (mobile ? 17 : 10.5) - 2 * t;
      eye.set(Math.sin(a) * r, 1.35 + 0.5 * t - c.py * 0.15, Math.cos(a) * r);
      tgt.set(0, mobile ? 3.2 : 2.05, 0);
      look(out, eye, tgt);
      out.focus.set(0, 0, 0);
      out.fog = 0.02;
      return;
    }
    case 1: {
      // specimen orbit: front 3/4 -> side -> rear 3/4, car framed right of the copy
      const a = -1.1 - 1.05 * t;
      const r = mobile ? 11.5 : 6.8;
      eye.set(Math.sin(a) * r, 1.35 + 0.9 * t, Math.cos(a) * r);
      tgt.set(0, mobile ? -0.9 : 0.45, 0);
      if (!mobile) pan(eye, tgt, -2.1);
      look(out, eye, tgt);
      out.focus.set(0, 0, 0);
      out.fog = 0.022;
      return;
    }
    case 2: {
      // lockstep top-down: world scrolls 1:1 with the DOM
      const camZ = Math.max(driveCamZ(L, c.scrollY, c.driveTop), ((0.5 - L.carScreenY) * L.vh) / L.ppw);
      eye.set(0, L.camH, camZ);
      tgt.set(0, 0, camZ);
      look(out, eye, tgt, DOWN_UP);
      const carZ = Math.min(DRIVE_LEN, Math.max(0, camZ - ((0.5 - L.carScreenY) * L.vh) / L.ppw));
      out.focus.set(pathX(L.keys, carZ), 0, carZ);
      out.fog = 0.0045;
      return;
    }
    case 3: {
      if (c.aspect < 0.9) {
        // portrait: straight down, S-curve's long axis runs up the screen
        const d = 96 / tanHalf;
        eye.set(-8 + 16 * t, d, S_CENTER_Z);
        tgt.set(-8 + 16 * t, 0, S_CENTER_Z);
        look(out, eye, tgt, PORTRAIT_UP);
      } else {
        const hTan = tanHalf * c.aspect;
        const d = Math.min(150, 78 / hTan);
        const pitch = 1.0;
        const x = -10 + 20 * t;
        eye.set(x, Math.sin(pitch) * d, S_CENTER_Z + Math.cos(pitch) * d);
        tgt.set(x * 0.4, 0, S_CENTER_Z - 4);
        look(out, eye, tgt);
      }
      out.focus.set(0, 0, S_CENTER_Z);
      out.fog = 0.0028;
      return;
    }
    case 4: {
      const k2 = smooth01((t - 0.05) / 0.85);
      const fx = -34 + 70 * k2;
      if (mobile) {
        eye.set(fx - 8, 30, U_CENTER_Z + 34);
        tgt.set(fx, 0, U_CENTER_Z + 6);
      } else {
        eye.set(fx * 0.6 - 14, 20, U_CENTER_Z + 40);
        tgt.set(fx * 0.6, 0, U_CENTER_Z + 5);
      }
      look(out, eye, tgt);
      out.focus.set(fx * 0.6, 0, U_CENTER_Z);
      out.fog = 0.008;
      return;
    }
    default: {
      // launch gate: rise and look back down the straight
      if (mobile) {
        eye.set(24 - 6 * t, 44 + 8 * t, U_CENTER_Z + 58);
        tgt.set(30, 0, U_CENTER_Z + 2);
      } else {
        eye.set(44 - 10 * t, 30 + 10 * t, U_CENTER_Z + 54);
        tgt.set(26, 0, U_CENTER_Z + 2);
      }
      look(out, eye, tgt);
      out.focus.set(30, 0, U_CENTER_Z);
      out.fog = 0.0075;
    }
  }
}

function blend(a: Pose, b: Pose, w: number, out: Pose) {
  out.pos.lerpVectors(a.pos, b.pos, w);
  out.quat.slerpQuaternions(a.quat, b.quat, w);
  out.focus.lerpVectors(a.focus, b.focus, w);
  out.fog = a.fog + (b.fog - a.fog) * w;
}

export default function CameraRig({ bus, layout }: { bus: LandingBus; layout: LandingLayout }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const poses = useMemo(() => ({ a: mkPose(), b: mkPose(), out: mkPose() }), []);
  const ctx = useMemo<Ctx>(() => ({ layout, scrollY: 0, driveTop: 0, aspect: 1, time: 0, px: 0, py: 0 }), [layout]);
  const ptr = useMemo(() => ({ x: 0, y: 0 }), []);

  useFrame((state, dt) => {
    const s = bus.choreo.current;
    const ch = s.chapters;
    const y = s.scrollY;
    const vh = s.vh;
    const reduced = s.reducedMotion;
    ctx.scrollY = y;
    ctx.driveTop = ch[2].top;
    ctx.aspect = state.size.width / Math.max(1, state.size.height);
    ctx.time = reduced ? 0 : state.clock.elapsedTime;
    ptr.x = THREE.MathUtils.damp(ptr.x, reduced ? 0 : bus.pointer.x, 3, dt);
    ptr.y = THREE.MathUtils.damp(ptr.y, reduced ? 0 : bus.pointer.y, 3, dt);
    ctx.px = ptr.x;
    ctx.py = ptr.y;

    let k = 0;
    for (let i = 0; i < ch.length; i++) if (y >= ch[i].top - 0.5) k = i;
    const tOf = (i: number) => (reduced && i !== 2 ? 0.5 : ch[i].progress);
    const { a, b, out } = poses;
    evalChapter(k, tOf(k), ctx, out);

    if (!reduced) {
      const win = (i: number): [number, number] => {
        const [pre, post] = WINDOWS[i];
        return [ch[i].top - pre * vh, ch[i].top + (i === 2 ? layout.rotatePx : post * vh)];
      };
      // approaching the next chapter
      if (k + 1 < ch.length) {
        const [s0, s1] = win(k + 1);
        if (y > s0) {
          a.pos.copy(out.pos);
          a.quat.copy(out.quat);
          a.focus.copy(out.focus);
          a.fog = out.fog;
          evalChapter(k + 1, 0, ctx, b);
          blend(a, b, smooth01((y - s0) / (s1 - s0)), out);
        }
      }
      // just entered chapter k
      if (k >= 1) {
        const [s0, s1] = win(k);
        if (y < s1) {
          evalChapter(k - 1, 1, ctx, a);
          b.pos.copy(out.pos);
          b.quat.copy(out.quat);
          b.focus.copy(out.focus);
          b.fog = out.fog;
          blend(a, b, smooth01((y - s0) / (s1 - s0)), out);
        }
      }
    }

    camera.position.copy(out.pos);
    camera.quaternion.copy(out.quat);
    camera.updateMatrixWorld();
    bus.focus.copy(out.focus);
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = out.fog;
  });

  return null;
}
