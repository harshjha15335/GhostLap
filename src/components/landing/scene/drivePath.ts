import * as THREE from 'three';
import { buildFrames, frameAt, type Frames, type KerbSpec } from './Road';

/** World position of the drive road's start line (far from the hero / S-curve sets). */
export const DRIVE_ORIGIN = new THREE.Vector3(0, 0, -1400);
/** asphalt width, world units (the car is ~5.2 long) */
export const ROAD_WIDTH = 13;

/**
 * The scroll-drive chapter's winding road: a hand-laid sequence of straights and
 * constant-radius bends (no real circuit, so nothing to misrepresent). Lap fraction f
 * runs from the start line to the finish line by arc length; the ribbon extends a
 * little before and after so the camera never sees the road end.
 */
export interface DrivePath {
  /** dense centre line incl. lead-in / run-out */
  points: THREE.Vector3[];
  frames: Frames;
  kerbs: KerbSpec[];
  /** arc length of the start / finish lines on the full ribbon */
  sStart: number;
  sEnd: number;
  /** start -> finish length, world units */
  lapLen: number;
  /** world-space bounds of the lap's centre line (x/z) */
  bounds: { cx: number; cz: number; hx: number; hz: number };
  /** world position at lap fraction f (0..1, may extend slightly beyond) */
  point(f: number, out?: THREE.Vector3): THREE.Vector3;
  /** horizontal unit heading at f, averaged over ±`window` world units (0 = local tangent) */
  heading(f: number, out?: THREE.Vector3, window?: number): THREE.Vector3;
}

type Seg = { straight: number } | { turn: number; r: number };

const D = Math.PI / 180;
/** + turn = right */
const SEGMENTS: Seg[] = [
  { straight: 70 }, // lead-in before the start line
  { straight: 46 },
  { turn: -70 * D, r: 52 },
  { straight: 26 },
  { turn: 95 * D, r: 44 },
  { straight: 22 },
  { turn: -60 * D, r: 62 },
  { straight: 30 },
  { turn: 85 * D, r: 40 },
  { straight: 20 },
  { turn: -75 * D, r: 56 },
  { straight: 28 },
  { turn: 55 * D, r: 70 },
  { straight: 48 },
  { straight: 170 }, // run-out after the finish
];
const LEAD_IN = 70;
const RUN_OUT = 170;
const STEP = 0.5;

export function buildDrivePath(): DrivePath {
  const pts: THREE.Vector3[] = [];
  const kerbs: KerbSpec[] = [];
  let x = DRIVE_ORIGIN.x;
  let z = DRIVE_ORIGIN.z - LEAD_IN;
  // heading angle: direction = (sin h, cos h); h = 0 -> +Z; right of +Z is -X, so a right turn decreases h
  let h = 0;
  let s = 0;
  pts.push(new THREE.Vector3(x, 0, z));
  for (const seg of SEGMENTS) {
    if ('straight' in seg) {
      const n = Math.round(seg.straight / STEP);
      for (let i = 0; i < n; i++) {
        x += Math.sin(h) * STEP;
        z += Math.cos(h) * STEP;
        pts.push(new THREE.Vector3(x, 0, z));
      }
      s += n * STEP;
    } else {
      const len = Math.abs(seg.turn) * seg.r;
      const n = Math.max(4, Math.round(len / STEP));
      const dh = -seg.turn / n;
      const ds = len / n;
      const side: 1 | -1 = seg.turn > 0 ? 1 : -1;
      // inside apex kerb + outside exit kerb running onto the straight
      kerbs.push({ s0: s + len * 0.14, s1: s + len * 0.88, side });
      kerbs.push({ s0: s + len * 0.58, s1: s + len + 11, side: side === 1 ? -1 : 1 });
      for (let i = 0; i < n; i++) {
        // midpoint rule keeps the arc exact
        h += dh / 2;
        x += Math.sin(h) * ds;
        z += Math.cos(h) * ds;
        h += dh / 2;
        pts.push(new THREE.Vector3(x, 0, z));
      }
      s += len;
    }
  }
  const frames = buildFrames(pts);
  const sStart = LEAD_IN;
  const sEnd = frames.length - RUN_OUT;
  const lapLen = sEnd - sStart;
  const fr = { x: 0, z: 0, rx: 0, rz: 0 };
  const point = (f: number, out = new THREE.Vector3()) => {
    frameAt(frames, sStart + f * lapLen, fr);
    return out.set(fr.x, 0, fr.z);
  };
  const tmp = new THREE.Vector3();
  const heading = (f: number, out = new THREE.Vector3(), window = 0) => {
    const w = Math.max(window, 0.6) / lapLen;
    point(f + w, out);
    point(f - w, tmp);
    out.sub(tmp);
    out.y = 0;
    return out.lengthSq() > 1e-9 ? out.normalize() : out.set(0, 0, 1);
  };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i <= 300; i++) {
    point(i / 300, tmp);
    minX = Math.min(minX, tmp.x);
    maxX = Math.max(maxX, tmp.x);
    minZ = Math.min(minZ, tmp.z);
    maxZ = Math.max(maxZ, tmp.z);
  }
  return {
    points: pts,
    frames,
    kerbs,
    sStart,
    sEnd,
    lapLen,
    bounds: { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2 },
    point,
    heading,
  };
}
