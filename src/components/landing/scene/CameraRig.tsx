import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { range01, smooth01 } from '@/hooks/useScrollChoreography';
import type { LandingBus, SceneSet } from '../bus';
import { FOV, SCENE_CHAPTERS, S_CENTER_Z, driveLapT, type LandingLayout } from '../layout';
import { PALETTE } from '../palette';

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  focus: THREE.Vector3;
}

const mkPose = (): Pose => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), focus: new THREE.Vector3() });

/** [before, after] blend window around each chapter boundary, in viewport heights. */
const WINDOWS: [number, number][] = [
  [0, 0],
  [0.55, 0.45],
  [0.55, 0.45],
  [0.55, 0.5],
];
/** set on stage per scene chapter */
const SET_OF: SceneSet[] = ['studio', 'studio', 'circuit', 'studio'];
/** paper colour of the wipe that hides the set change INTO chapter i (matches that chapter's ground) */
const WIPE_OF = ['', '', PALETTE.chartreuse, PALETTE.lilac];

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const m4 = new THREE.Matrix4();
const qTmp = new THREE.Quaternion();
const eye = new THREE.Vector3();
const tgt = new THREE.Vector3();
const head = new THREE.Vector3();
const carP = new THREE.Vector3();

function look(out: Pose, e: THREE.Vector3, t: THREE.Vector3, up = UP) {
  out.pos.copy(e);
  m4.lookAt(e, t, up);
  out.quat.setFromRotationMatrix(m4);
  out.focus.copy(t);
}

const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);

/**
 * Re-aim the camera (rotate in place) so the point it currently looks at lands at
 * screen fraction (sx, sy) — 0,0 top-left. Used to frame the car below the headline
 * or beside the copy without moving the eye.
 */
function frameAt(out: Pose, sx: number, sy: number, aspect: number) {
  const yaw = Math.atan((2 * sx - 1) * tanHalf * aspect);
  const pitch = Math.atan((2 * sy - 1) * tanHalf);
  if (yaw) out.quat.multiply(qTmp.setFromAxisAngle(AY, yaw));
  if (pitch) out.quat.multiply(qTmp.setFromAxisAngle(AX, pitch));
}

interface Ctx {
  bus: LandingBus;
  layout: LandingLayout;
  scrollY: number;
  driveTop: number;
  aspect: number;
  time: number;
  px: number;
  py: number;
}

/** Distance at which a ~5.4-unit car spans `frac` of the viewport width / `vfrac` of its height. */
function fitDistance(aspect: number, frac: number, vfrac: number, carW = 5.4, carH = 2.4) {
  const dW = carW / (frac * 2 * tanHalf * aspect);
  const dH = carH / (vfrac * 2 * tanHalf);
  return Math.max(dW, dH);
}

/**
 * Hero geometry (document px): the car sits centred just under the headline, and the
 * backdrop's curved horizon runs through its lower body, like a product on a paper set.
 */
export function heroGeom(c: { aspect: number; vh: number; bus: LandingBus }) {
  const portrait = c.aspect < 0.9;
  const vw = c.vh * c.aspect;
  const fr = c.bus.heroFrame;
  let frac = portrait ? 0.9 : Math.min(0.46, 0.34 + 0.06 / c.aspect);
  // projected 3/4 car height relative to its width
  const hRatio = 0.5;
  let hPx = frac * vw * hRatio;
  const gap = c.vh * (portrait ? 0.03 : 0.015);
  if (portrait) {
    // phones: the whole car must sit between the headline and the scroll cue
    const room = Math.max(60, fr.bottom - fr.top - gap * 2);
    if (hPx > room) {
      frac *= room / hPx;
      hPx = room;
    }
  }
  // desktop: tucked right under the headline (it may run off the first screen, like the
  // reference); phones: a little lower, in the upper part of the free band
  const band = fr.bottom - fr.top;
  const cy = fr.top + Math.max(gap + hPx / 2, portrait ? band * 0.4 : 0);
  return { frac, cy, hPx, horizon: cy + hPx * 0.16, sag: portrait ? c.vh * 0.075 : c.vh * 0.2 };
}

function chase(c: Ctx, f: number, out: Pose) {
  const p = c.bus.path;
  const L = c.layout;
  if (!p) return;
  p.point(f, carP);
  p.heading(f, head, 18);
  const portrait = c.aspect < 0.9;
  const H = portrait ? 76 : 60;
  const back = 20;
  eye.copy(carP).addScaledVector(head, -back);
  eye.y += H;
  look(out, eye, carP);
  frameAt(out, 0.5, L.carScreenY, c.aspect);
  out.focus.copy(carP);
}

/** drive intro: high above the start line, looking down the road winding away */
function roadIntro(c: Ctx, out: Pose) {
  const p = c.bus.path;
  if (!p) return;
  const portrait = c.aspect < 0.9;
  p.point(0, carP);
  p.heading(0, head, 4);
  p.point(0.055, tgt);
  eye.copy(carP).addScaledVector(head, portrait ? -46 : -52);
  eye.y += portrait ? 150 : 96;
  look(out, eye, tgt);
  out.focus.copy(carP);
}

/** after the flag: rise above the car and look back over the tyre marks */
function roadOutro(c: Ctx, out: Pose) {
  const p = c.bus.path;
  if (!p) return;
  const portrait = c.aspect < 0.9;
  // straight down, road still running up the screen: the finish line and the marks behind it
  p.point(0.985, carP);
  p.heading(0.97, head, 30);
  eye.copy(carP);
  eye.y += portrait ? 190 : 125;
  look(out, eye, carP, head);
  out.focus.copy(carP);
}

/** pose for scene chapter k at local progress t */
function evalChapter(k: number, t: number, c: Ctx, out: Pose) {
  const L = c.layout;
  const mobile = L.mobile || c.aspect < 0.9;
  switch (k) {
    case 0: {
      // hero: the car turns slowly (HeroCar) centred under the headline and rides the
      // page up as it scrolls, on the backdrop's curved horizon
      const g = heroGeom({ aspect: c.aspect, vh: L.vh, bus: c.bus });
      const d = fitDistance(c.aspect, g.frac, 1) * (1 - 0.04 * t);
      const e = mobile ? 0.34 : 0.3;
      const a = -0.5 + c.px * 0.06 + Math.sin(c.time * 0.15) * 0.03;
      tgt.set(0, 0.5, 0);
      eye.set(Math.sin(a) * Math.cos(e) * d, 0.5 + Math.sin(e) * d - c.py * 0.2, Math.cos(a) * Math.cos(e) * d);
      look(out, eye, tgt);
      frameAt(out, 0.5, (g.cy - c.scrollY) / L.vh, c.aspect);
      out.focus.set(0, 0, 0);
      return;
    }
    case 1: {
      // specimen orbit: front 3/4 -> side -> rear 3/4, car framed right of the copy
      const a = -1.1 - 1.05 * t;
      const d = mobile ? fitDistance(c.aspect, 0.78, 0.4, 5.8) : fitDistance(c.aspect, 0.5, 0.6);
      tgt.set(0, 0.45, 0);
      eye.set(Math.sin(a) * d, 0.45 + d * (0.1 + 0.08 * t), Math.cos(a) * d);
      look(out, eye, tgt);
      frameAt(out, mobile ? 0.5 : 0.64, mobile ? 0.3 : 0.5, c.aspect);
      out.focus.set(0, 0, 0);
      return;
    }
    case 2: {
      const d = c.scrollY - c.driveTop;
      const end = L.introPx + L.drivePx;
      if (d <= end) {
        // hold above the start, then dive into the chase
        const w = smooth01(range01(d, L.introPx * 0.3, L.introPx));
        if (w <= 0) {
          roadIntro(c, out);
          return;
        }
        chase(c, c.bus.lapT, out);
        if (w < 1) {
          copyPose(out, poolB);
          roadIntro(c, poolA);
          blendLog(poolA, poolB, w, out);
        }
        return;
      }
      const w = smooth01(range01(d, end, end + L.outroPx));
      chase(c, 1, poolB);
      roadOutro(c, poolA);
      blendLog(poolB, poolA, w, out);
      return;
    }
    case 3: {
      if (c.aspect < 0.9) {
        // portrait: straight down, S-curve's long axis runs up the screen
        const d = 96 / tanHalf;
        eye.set(-8 + 16 * t, d, S_CENTER_Z);
        tgt.set(-8 + 16 * t, 0, S_CENTER_Z);
        look(out, eye, tgt, new THREE.Vector3(1, 0, 0));
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
      return;
    }
    default:
      // DOM-only chapters cover the canvas (it is paused there): hold the ribbon shot
      evalChapter(3, 1, c, out);
  }
}

const poolA = mkPose();
const poolB = mkPose();

function copyPose(a: Pose, out: Pose) {
  out.pos.copy(a.pos);
  out.quat.copy(a.quat);
  out.focus.copy(a.focus);
}

function blend(a: Pose, b: Pose, w: number, out: Pose) {
  out.pos.lerpVectors(a.pos, b.pos, w);
  out.quat.slerpQuaternions(a.quat, b.quat, w);
  out.focus.lerpVectors(a.focus, b.focus, w);
}

/** blend with the height interpolated in log space (smooth zooms over 20x height changes) */
function blendLog(a: Pose, b: Pose, w: number, out: Pose) {
  const ya = Math.max(1, a.pos.y);
  const yb = Math.max(1, b.pos.y);
  const y = Math.exp(Math.log(ya) + (Math.log(yb) - Math.log(ya)) * w);
  // horizontal travel follows the zoom so the dive feels like one move
  const k = Math.abs(yb - ya) > 1e-3 ? (y - ya) / (yb - ya) : w;
  out.pos.lerpVectors(a.pos, b.pos, k);
  out.pos.y = y;
  out.quat.slerpQuaternions(a.quat, b.quat, w);
  out.focus.lerpVectors(a.focus, b.focus, k);
}

export default function CameraRig({ bus, layout }: { bus: LandingBus; layout: LandingLayout }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const poses = useMemo(() => ({ a: mkPose(), b: mkPose(), out: mkPose() }), []);
  const ctx = useMemo<Ctx>(() => ({ bus, layout, scrollY: 0, driveTop: 0, aspect: 1, time: 0, px: 0, py: 0 }), [bus, layout]);
  const ptr = useMemo(() => ({ x: 0, y: 0, lap: -1 }), []);

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

    // lap progress follows the scroll with a little inertia (exact under reduced motion)
    const lapTarget = driveLapT(layout, y, ch[2].top);
    if (ptr.lap < 0 || reduced || Math.abs(lapTarget - ptr.lap) > 0.25) ptr.lap = lapTarget;
    else ptr.lap = THREE.MathUtils.damp(ptr.lap, lapTarget, 7, Math.min(dt, 0.05));
    bus.lapT = ptr.lap;

    const n = Math.min(ch.length, SCENE_CHAPTERS);
    let k = 0;
    for (let i = 0; i < n; i++) if (y >= ch[i].top - 0.5) k = i;
    // reduced motion: one static composition per chapter
    const tOf = (i: number) => (reduced && i !== 2 ? 0.5 : ch[i].progress);
    const { a, b, out } = poses;
    evalChapter(k, tOf(k), ctx, out);
    let set = SET_OF[Math.min(k, 3)];
    // wipe state: cover 0..1 slides the sheet up to fill the screen, 1..2 carries it off the top
    let cover = 0;
    let wipeO = 0;
    let wipeC = '';

    if (!reduced) {
      const win = (i: number): [number, number] => {
        const [pre, post] = WINDOWS[i];
        return [ch[i].top - pre * vh, ch[i].top + post * vh];
      };
      /** blend from pose `from` (chapter i-1) to `to` (chapter i); set changes are a dip to black */
      const mix = (i: number, from: Pose, to: Pose, w: number) => {
        if (SET_OF[i - 1] === SET_OF[i]) {
          blend(from, to, w, out);
          return;
        }
        // a curved paper sheet in the next chapter's colour slides up over the screen,
        // the set swaps under it, then it carries on up and off (its straight bottom
        // edge reveals the new ground, which is the same colour)
        wipeC = WIPE_OF[i];
        cover = w < 0.5 ? smooth01(w / 0.44) : 1 + smooth01((w - 0.56) / 0.44);
        wipeO = cover >= 1.999 ? 0 : 1;
        set = w < 0.5 ? SET_OF[i - 1] : SET_OF[i];
        if (w < 0.5) {
          // push in toward the subject while the wipe rises
          copyPose(from, out);
          out.pos.lerp(out.focus, 0.18 * smooth01(w * 2));
        } else copyPose(to, out);
      };
      // approaching the next chapter
      if (k + 1 < n) {
        const [s0, s1] = win(k + 1);
        if (y > s0) {
          copyPose(out, a);
          evalChapter(k + 1, 0, ctx, b);
          mix(k + 1, a, b, smooth01((y - s0) / (s1 - s0)));
        }
      }
      // just entered chapter k
      if (k >= 1) {
        const [s0, s1] = win(k);
        if (y < s1) {
          evalChapter(k - 1, 1, ctx, a);
          copyPose(out, b);
          mix(k, a, b, smooth01((y - s0) / (s1 - s0)));
        }
      }
    }

    bus.set = set;
    bus.showCar = set === 'circuit' || k <= 1 || (k === 2 && y < ch[2].top);
    const hg = heroGeom({ aspect: ctx.aspect, vh: layout.vh, bus });
    bus.horizon.y = hg.horizon;
    bus.horizon.sag = hg.sag;
    const vl = bus.veil;
    if (vl) {
      const o = wipeO.toFixed(3);
      if (vl.style.opacity !== o) vl.style.opacity = o;
      if (wipeO > 0) {
        const ty = cover <= 1 ? (1 - cover) * 92 : -(cover - 1) * 100;
        const tr = `translate3d(0, ${ty.toFixed(2)}%, 0)`;
        if (vl.style.transform !== tr) vl.style.transform = tr;
        if (wipeC && vl.dataset.c !== wipeC) {
          vl.dataset.c = wipeC;
          vl.style.setProperty('--wipe', wipeC);
        }
      }
    }

    camera.position.copy(out.pos);
    camera.quaternion.copy(out.quat);
    camera.updateMatrixWorld();
    bus.focus.copy(out.focus);
  });

  return null;
}
