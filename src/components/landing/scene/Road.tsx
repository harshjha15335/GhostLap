import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { acquirePaperTexture, releasePaperTexture, roadAsphaltTexture } from './textures';

/**
 * A crisp, readable stretch of race track laid along a dense centre line:
 *
 *   run-off band | kerb | white line · asphalt · racing line · asphalt · white line | kerb | run-off band
 *
 * Every layer is built from the same per-point frames (arc length, right vector), so edges
 * stay parallel and the white lines keep a constant width through the bends. Flat layers
 * are separated by small y offsets plus polygon offset (no depth fighting); kerbs are real
 * sloped, raised blocks of equal length that ramp down to the ground at both ends.
 */

export interface KerbSpec {
  /** arc-length range along the centre line, world units */
  s0: number;
  s1: number;
  /** +1 = right of travel, -1 = left */
  side: 1 | -1;
}

export interface RoadSpec {
  /** dense, evenly spaced centre line on the ground (y = 0), in travel order */
  points: THREE.Vector3[];
  width: number;
  kerbs: KerbSpec[];
  /** width of the painted run-off band beyond the kerb zone, each side */
  runoff?: number;
  runoffColor?: string;
  /** thin outer border of the run-off band */
  borderColor?: string;
  /** arc lengths that get a chequered start / finish band */
  checkers?: number[];
}

/** render order of the ground decal stack (after the backdrop, before everything else) */
export const GROUND_ORDER = -50;
export const KERB_W = 1.25;
const KERB_H = 0.12;
const KERB_BLOCK = 1.5;
const LINE_W = 0.34;
const LINE_IN = 0.06;

export interface Frames {
  n: number;
  s: Float32Array;
  px: Float32Array;
  pz: Float32Array;
  /** right-of-travel unit vector */
  rx: Float32Array;
  rz: Float32Array;
  /** signed curvature (+ = turning right), lightly smoothed */
  k: Float32Array;
  length: number;
}

export function buildFrames(points: THREE.Vector3[]): Frames {
  const n = points.length;
  const s = new Float32Array(n);
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  const rx = new Float32Array(n);
  const rz = new Float32Array(n);
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = points[i].x;
    pz[i] = points[i].z;
    if (i) s[i] = s[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = points[b].x - points[a].x;
    let dz = points[b].z - points[a].z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    tx[i] = dx;
    tz[i] = dz;
    rx[i] = -dz;
    rz[i] = dx;
  }
  const raw = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) {
    const ds = s[i + 1] - s[i - 1] || 1;
    // rate at which the tangent swings toward the right vector
    raw[i] = ((tx[i + 1] - tx[i - 1]) * rx[i] + (tz[i + 1] - tz[i - 1]) * rz[i]) / ds;
  }
  const W = 6;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let c = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
      acc += raw[j];
      c++;
    }
    k[i] = acc / c;
  }
  return { n, s, px, pz, rx, rz, k, length: s[n - 1] };
}

/**
 * Kerbs from curvature: an apex kerb on the inside wherever the bend is tighter than
 * `minRadius`, plus an exit kerb on the outside over the last part of the bend.
 */
export function autoKerbs(f: Frames, minRadius: number): KerbSpec[] {
  const out: KerbSpec[] = [];
  const thr = 1 / minRadius;
  let i = 0;
  while (i < f.n) {
    if (Math.abs(f.k[i]) < thr) {
      i++;
      continue;
    }
    const sign = f.k[i] > 0 ? 1 : -1;
    const a = i;
    while (i < f.n && Math.abs(f.k[i]) >= thr && (f.k[i] > 0 ? 1 : -1) === sign) i++;
    const s0 = f.s[a];
    const s1 = f.s[Math.min(f.n - 1, i)];
    const len = s1 - s0;
    if (len < 6) continue;
    const side = sign as 1 | -1;
    out.push({ s0: s0 + len * 0.08, s1: s1 - len * 0.08, side });
    out.push({ s0: s0 + len * 0.62, s1: Math.min(f.length - 1, s1 + 8), side: side === 1 ? -1 : 1 });
  }
  return out;
}

/** Interpolated frame at arc length `at` (clamped). */
export function frameAt(f: Frames, at: number, out: { x: number; z: number; rx: number; rz: number }) {
  const { s, n } = f;
  if (at <= 0) {
    out.x = f.px[0];
    out.z = f.pz[0];
    out.rx = f.rx[0];
    out.rz = f.rz[0];
    return out;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (s[m] < at) lo = m;
    else hi = m;
  }
  const u = Math.min(1, Math.max(0, (at - s[lo]) / (s[hi] - s[lo] || 1)));
  out.x = f.px[lo] + (f.px[hi] - f.px[lo]) * u;
  out.z = f.pz[lo] + (f.pz[hi] - f.pz[lo]) * u;
  let rx = f.rx[lo] + (f.rx[hi] - f.rx[lo]) * u;
  let rz = f.rz[lo] + (f.rz[hi] - f.rz[lo]) * u;
  const l = Math.hypot(rx, rz) || 1;
  rx /= l;
  rz /= l;
  out.rx = rx;
  out.rz = rz;
  return out;
}

/**
 * Flat strip between lateral offsets a(i)..b(i) (right of travel positive) at height y.
 * uv = (arc length, lateral offset) / texScale.
 */
function strip(f: Frames, a: (i: number) => number, b: (i: number) => number, y: number, texScale = 1): THREE.BufferGeometry {
  const { n } = f;
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const nrm = new Float32Array(n * 6);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const oa = a(i);
    const ob = b(i);
    pos.set([f.px[i] + f.rx[i] * oa, y, f.pz[i] + f.rz[i] * oa, f.px[i] + f.rx[i] * ob, y, f.pz[i] + f.rz[i] * ob], i * 6);
    uv.set([f.s[i] / texScale, oa / texScale, f.s[i] / texScale, ob / texScale], i * 4);
    nrm.set([0, 1, 0, 0, 1, 0], i * 6);
    if (i < n - 1) {
      const k = i * 2;
      // a is left of b (a < b): counter-clockwise seen from above (normal up)
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const RED = new THREE.Color('#E10600').multiplyScalar(0.5);
const WHITE = new THREE.Color('#F4F4F2').multiplyScalar(0.85);

/**
 * Raised kerbs as one merged, vertex-coloured mesh. Cross-section (road side -> outside):
 * flush with the asphalt, a short ramp up to a flat top, then a small wall to the ground.
 * Blocks share one exact length per kerb (the range is divided evenly), and the height
 * eases to zero over the first and last metre so ends never stand up as jagged fragments.
 */
function kerbGeometry(f: Frames, kerbs: KerbSpec[], halfW: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col: number[] = [];
  const fr = { x: 0, z: 0, rx: 0, rz: 0 };
  // lateral profile (offset from road edge, height)
  const prof: [number, number][] = [
    [0, 0.026],
    [0.32, KERB_H],
    [KERB_W, KERB_H],
    [KERB_W, 0.004],
  ];
  const sec = (at: number, side: number, hScale: number) => {
    frameAt(f, at, fr);
    return prof.map(([o, h]) => {
      const off = side * (halfW + o);
      const hh = h <= 0.03 ? h : 0.026 + (h - 0.026) * hScale;
      return [fr.x + fr.rx * off, hh, fr.z + fr.rz * off] as [number, number, number];
    });
  };
  for (const kb of kerbs) {
    const len = kb.s1 - kb.s0;
    if (len < KERB_BLOCK * 2) continue;
    const blocks = Math.max(2, Math.round(len / KERB_BLOCK));
    const bl = len / blocks;
    const sub = 4;
    const ramp = Math.min(1.2, len * 0.2);
    for (let j = 0; j < blocks; j++) {
      const c = j % 2 ? WHITE : RED;
      for (let q = 0; q < sub; q++) {
        const sa = kb.s0 + bl * (j + q / sub);
        const sb = kb.s0 + bl * (j + (q + 1) / sub);
        const ha = Math.min(1, (sa - kb.s0) / ramp, (kb.s1 - sa) / ramp);
        const hb = Math.min(1, (sb - kb.s0) / ramp, (kb.s1 - sb) / ramp);
        const A = sec(sa, kb.side, Math.max(0, ha));
        const B = sec(sb, kb.side, Math.max(0, hb));
        for (let p = 0; p < prof.length - 1; p++) {
          const a0 = A[p];
          const a1 = A[p + 1];
          const b0 = B[p];
          const b1 = B[p + 1];
          // face winding so normals point up / outward for either side
          const tri = kb.side > 0 ? [a0, a1, b0, a1, b1, b0] : [a0, b0, a1, a1, b0, b1];
          for (const v of tri) {
            pos.push(v[0], v[1], v[2]);
            col.push(c.r, c.g, c.b);
          }
        }
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Soft-edged across-track gradient (alpha) for the rubbered racing line. */
function bandAlpha() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.3, '#999');
  grad.addColorStop(0.5, '#fff');
  grad.addColorStop(0.7, '#999');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111317' : '#F4F4F2';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export default function Road({ spec }: { spec: RoadSpec }) {
  const { width, kerbs, runoff = 3.2, runoffColor = '#2E9E48', borderColor = '#F4F4F2', checkers = [] } = spec;
  const frames = useMemo(() => buildFrames(spec.points), [spec.points]);
  const hw = width / 2;

  const geo = useMemo(() => {
    const f = frames;
    const outer = hw + KERB_W + runoff;
    // racing line: drifts toward the inside of each bend, centred on the straights
    const race = (i: number) => {
      const o = THREE.MathUtils.clamp(f.k[i] * 160, -hw * 0.55, hw * 0.55);
      return o;
    };
    const geos = {
      runoff: strip(f, () => -outer, () => outer, 0.012),
      border: strip(f, () => -outer - 0.35, () => outer + 0.35, 0.006),
      asphalt: strip(f, () => -hw, () => hw, 0.026, 7),
      race: strip(f, (i) => race(i) - 1.6, (i) => race(i) + 1.6, 0.03),
      lineL: strip(f, () => -hw + LINE_IN, () => -hw + LINE_IN + LINE_W, 0.034),
      lineR: strip(f, () => hw - LINE_IN - LINE_W, () => hw - LINE_IN, 0.034),
    };
    // race band uv.y must run 0..1 across for the alpha gradient
    const ruv = geos.race.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < ruv.count; i++) ruv.setY(i, i % 2);
    const kerb = kerbGeometry(f, kerbs, hw);
    // chequered bands across the asphalt
    const fr = { x: 0, z: 0, rx: 0, rz: 0 };
    const chk = checkers.map((at) => {
      const pts: number[] = [];
      const uv: number[] = [];
      const depth = 2.4;
      const cs = [at - depth / 2, at + depth / 2];
      const corners = cs.map((sv) => {
        frameAt(f, sv, fr);
        return [
          [fr.x - fr.rx * (hw - 0.02), fr.z - fr.rz * (hw - 0.02)],
          [fr.x + fr.rx * (hw - 0.02), fr.z + fr.rz * (hw - 0.02)],
        ];
      });
      const [[a0, a1], [b0, b1]] = corners;
      const quad = [a0, a1, b0, a1, b1, b0];
      const quv = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      quad.forEach((p, i) => {
        pts.push(p[0], 0.036, p[1]);
        uv.push(quv[i][0], quv[i][1]);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    });
    return { ...geos, kerb, chk };
  }, [frames, hw, kerbs, runoff, checkers]);

  const mats = useMemo(() => {
    const asphaltMap = roadAsphaltTexture();
    const alpha = bandAlpha();
    const checkerTex = checkerTexture();
    // flat layers are decals: painted in a fixed order without depth writes, so they can
    // never fight each other; kerbs, cars and skid marks still depth-test against each other
    const decal = (m: THREE.Material) => {
      m.depthWrite = false;
      return m;
    };
    return {
      asphaltMap,
      alpha,
      checkerTex,
      border: decal(new THREE.MeshBasicMaterial({ color: borderColor, toneMapped: false })),
      runoff: decal(new THREE.MeshBasicMaterial({ color: runoffColor, toneMapped: false })),
      asphalt: decal(new THREE.MeshStandardMaterial({ color: '#3a3f47', map: asphaltMap, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 })),
      race: decal(new THREE.MeshBasicMaterial({ color: '#0b0c0f', alphaMap: alpha, transparent: true, opacity: 0.32, depthWrite: false })),
      line: decal(new THREE.MeshBasicMaterial({ color: '#F6F6F2', toneMapped: false })),
      checker: decal(new THREE.MeshBasicMaterial({ map: checkerTex, toneMapped: false })),
      // unmapped Lambert with half-strength colours: under the ~2x daylight rig the flat
      // tops land on true kerb red / white while the ramps keep a little shading
      kerb: new THREE.MeshLambertMaterial({ vertexColors: true, toneMapped: false }),
    };
  }, [runoffColor, borderColor]);

  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => {
        if (Array.isArray(g)) g.forEach((x) => x.dispose());
        else g?.dispose();
      });
    },
    [geo],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => (m as THREE.Material | THREE.Texture).dispose());
    },
    [mats],
  );

  return (
    <group>
      <mesh geometry={geo.border} material={mats.border} renderOrder={GROUND_ORDER + 1} />
      <mesh geometry={geo.runoff} material={mats.runoff} renderOrder={GROUND_ORDER + 2} />
      <mesh geometry={geo.asphalt} material={mats.asphalt} renderOrder={GROUND_ORDER + 3} />
      <mesh geometry={geo.race} material={mats.race} renderOrder={GROUND_ORDER + 4} />
      <mesh geometry={geo.lineL} material={mats.line} renderOrder={GROUND_ORDER + 5} />
      <mesh geometry={geo.lineR} material={mats.line} renderOrder={GROUND_ORDER + 5} />
      {geo.chk.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.checker} renderOrder={GROUND_ORDER + 6} />
      ))}
      {geo.kerb && <mesh geometry={geo.kerb} material={mats.kerb} />}
    </group>
  );
}

/** Large flat paper-textured ground in one colour (unlit, exact brand colour). */
export function PaperGround({ color, center, size, tile = 120 }: { color: string; center: [number, number]; size: [number, number]; tile?: number }) {
  const tex = useMemo(() => acquirePaperTexture(), []);
  useEffect(() => () => releasePaperTexture(), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, depthWrite: false });
    return m;
  }, [color]);
  // per-instance repeat without cloning the shared image: a uv-scaled geometry
  const g = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size[0], size[1]);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * size[0]) / tile, (uv.getY(i) * size[1]) / tile);
    return geo;
  }, [size, tile]);
  useEffect(() => {
    mat.map = tex;
    mat.needsUpdate = true;
  }, [mat, tex]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => g.dispose(), [g]);
  return <mesh geometry={g} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[center[0], 0, center[1]]} renderOrder={GROUND_ORDER} />;
}
