import type { CircuitGeometry } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';

/**
 * Pure (three-free apart from the curve) circuit layout model shared by the
 * environment builders: dense samples along the racing line with real, scaled
 * half-widths, signed curvature, detected corners, the room each side has before
 * another part of the circuit, and a terrain height/distance field.
 *
 * Approach and several constants (corner hysteresis radii, kerb width, run
 * padding and tapers, apron widths) follow Boxlane / F1TrackViewer by
 * makakashan (MIT, https://github.com/makakashan/F1TrackViewer); the code here is
 * an independent implementation for GhostLap's render space.
 */

export type Quality = 'high' | 'low';

export interface TrackModelOptions {
  quality: Quality;
  /** mean full track width in render units the real widths are scaled to */
  trackWidth: number;
  /** never narrower than this half-width (cars ride at fixed lane offsets) */
  minHalfWidth: number;
  /** right-hand pit lane: centre offset and width in render units (null = auto) */
  pitLane: { offset: number; width: number } | null;
  /** lap fraction covered by the pit lane on each side of the line */
  pitSpan: number;
}

export interface CornerRun {
  /** first / last sample (may wrap: end < start means across the line) */
  start: number;
  end: number;
  /** +1 = right-hand corner (inside on +right), -1 = left-hander */
  sign: 1 | -1;
  /** tightest radius, metres */
  minRadiusM: number;
  /** total heading change, radians (absolute) */
  turn: number;
  apex: number;
}

export interface TrackModel {
  n: number;
  /** samples: position, unit tangent (x/z), right vector (x/z), lap fraction */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  rx: Float32Array;
  rz: Float32Array;
  /** asphalt half-widths left / right in render units */
  hwL: Float32Array;
  hwR: Float32Array;
  /** signed curvature (1/render unit), + = turning right */
  kappa: Float32Array;
  /** 0 straight, ±1 inside of a corner on that side (right = +1) */
  cornerSide: Int8Array;
  corners: CornerRun[];
  /** free room (render units) from each asphalt edge to the next piece of circuit */
  roomL: Float32Array;
  roomR: Float32Array;
  /** render units per (exaggerated) metre: use for every lateral/prop size */
  M: number;
  /** render units per real metre along the track */
  upm: number;
  /** arc step between samples, render units */
  ds: number;
  length: number;
  meanHalf: number;
  hasRealWidths: boolean;
  pit: { centre: number; width: number; span: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; meanY: number };
  /** nearest sample index and planar distance for any x/z (brute force over a coarse subset + refine) */
  nearest(x: number, z: number): { i: number; d: number };
  /** inside the circuit loop (even-odd rule over the centre line) */
  infield(x: number, z: number): boolean;
}

const CORNER_ENTER_RADIUS_M = 170;
const CORNER_EXIT_RADIUS_M = 420;
const CORNER_MIN_RUN_M = 12;
const CORNER_PAD_M = 10;
const DEFAULT_WIDTH_M = 12;

export const wrapIndex = (i: number, n: number) => ((i % n) + n) % n;

function smoothCircular(src: Float32Array, k: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (k < 1) {
    out.set(src);
    return out;
  }
  let acc = 0;
  for (let j = -k; j <= k; j++) acc += src[wrapIndex(j, n)];
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * k + 1);
    acc += src[wrapIndex(i + k + 1, n)] - src[wrapIndex(i - k, n)];
  }
  return out;
}

/** Render units per real metre, from the data's own lap length. */
export function unitsPerMetre(circuit: CircuitGeometry): number {
  const p = circuit.points;
  let per = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    per += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  return circuit.lengthKm > 0 ? per / (circuit.lengthKm * 1000) : 0.1;
}

/** True when the circuit carries measured (non-uniform) widths. */
export function hasRealWidths(circuit: CircuitGeometry): boolean {
  const w = circuit.widths;
  if (!w || w.length !== circuit.points.length) return false;
  const a = w[0][0] + w[0][1];
  return w.some(([l, r]) => Math.abs(l + r - a) > 1e-3);
}

export function buildTrackModel(circuit: CircuitGeometry, cc: CircuitCurve, opts: TrackModelOptions): TrackModel {
  const length = cc.length;
  const step = opts.quality === 'high' ? 0.32 : 0.55;
  const n = Math.min(opts.quality === 'high' ? 2600 : 1500, Math.max(600, Math.round(length / step)));
  const ds = length / n;
  const upm = unitsPerMetre(circuit);

  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
  const tx = new Float32Array(n), tz = new Float32Array(n), rx = new Float32Array(n), rz = new Float32Array(n);
  const wl = new Float32Array(n), wr = new Float32Array(n);

  const widths = circuit.widths && circuit.widths.length === circuit.points.length ? circuit.widths : null;
  const np = circuit.points.length;
  const defHalf = (DEFAULT_WIDTH_M / 2) * upm;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity, sumY = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const p = cc.pointAt(u);
    const t = cc.tangentAt(u);
    px[i] = p.x;
    py[i] = p.y;
    pz[i] = p.z;
    const L = Math.hypot(t.x, t.z) || 1;
    tx[i] = t.x / L;
    tz[i] = t.z / L;
    // right = t × up
    rx[i] = -tz[i];
    rz[i] = tx[i];
    if (widths) {
      // the curve is arc-length parameterised; map back to the point index
      const f = cc.curve.getUtoTmapping(u, 0) * np;
      const a = Math.floor(f) % np;
      const b = (a + 1) % np;
      const k = f - Math.floor(f);
      wl[i] = widths[a][0] * (1 - k) + widths[b][0] * k;
      wr[i] = widths[a][1] * (1 - k) + widths[b][1] * k;
    } else {
      wl[i] = defHalf;
      wr[i] = defHalf;
    }
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    sumY += p.y;
  }

  // exaggeration: mean real width → requested mean render width
  let meanReal = 0;
  for (let i = 0; i < n; i++) meanReal += wl[i] + wr[i];
  meanReal /= n;
  const E = opts.trackWidth / meanReal;
  const M = E * upm;
  const meanHalf = opts.trackWidth / 2;
  const maxHalf = meanHalf * 1.55;

  // pit lane geometry (right-hand side, around the line)
  const pitWidth = opts.pitLane?.width ?? 11 * M;
  const pitCentre = opts.pitLane?.offset ?? meanHalf + 2.2 * M + pitWidth / 2;
  const pitInner = pitCentre - pitWidth / 2;
  const pitSpanN = Math.round(opts.pitSpan * n);

  let hwL = new Float32Array(n), hwR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hwL[i] = Math.min(maxHalf, Math.max(opts.minHalfWidth, wl[i] * E));
    let r = Math.min(maxHalf, Math.max(opts.minHalfWidth, wr[i] * E));
    const di = Math.min(i, n - i); // samples from the line
    if (di < pitSpanN) r = Math.min(r, Math.max(opts.minHalfWidth, pitInner - 0.9 * M));
    hwR[i] = r;
  }
  const wk = Math.max(1, Math.round((6 * upm) / ds));
  hwL = smoothCircular(hwL, wk);
  hwR = smoothCircular(hwR, wk);

  // signed curvature, smoothed over ±~12 m
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = wrapIndex(i - 1, n);
    const b = wrapIndex(i + 1, n);
    const dot = tx[a] * tx[b] + tz[a] * tz[b];
    const crs = tx[b] * rx[a] + tz[b] * rz[a]; // component of next tangent along previous right
    raw[i] = Math.atan2(crs, dot) / (2 * ds);
  }
  const kappa = smoothCircular(raw, Math.max(1, Math.round((12 * upm) / ds)));

  // corner runs with hysteresis (enter below 170 m, leave above 420 m)
  const enter = 1 / (CORNER_ENTER_RADIUS_M * upm);
  const exit = 1 / (CORNER_EXIT_RADIUS_M * upm);
  const side = new Int8Array(n);
  let origin = 0;
  for (let i = 1; i < n; i++) if (Math.abs(kappa[i]) < Math.abs(kappa[origin])) origin = i;
  let active = 0;
  for (let s = 0; s < n; s++) {
    const i = (origin + s) % n;
    const k = kappa[i];
    if (active === 0) {
      if (Math.abs(k) > enter) active = Math.sign(k);
    } else if (Math.sign(k) !== active || Math.abs(k) < exit) {
      active = Math.abs(k) > enter ? Math.sign(k) : 0;
    }
    side[i] = active;
  }
  // collect runs starting from the straightest point (never mid-corner)
  const corners: CornerRun[] = [];
  const minRun = Math.max(2, Math.round((CORNER_MIN_RUN_M * upm) / ds));
  const pad = Math.round((CORNER_PAD_M * upm) / ds);
  let s = 0;
  while (s < n) {
    const i = (origin + s) % n;
    if (side[i] === 0) {
      s++;
      continue;
    }
    const sign = side[i] as 1 | -1;
    let count = 0;
    let turn = 0;
    let apex = i;
    let kMax = 0;
    while (s < n && side[(origin + s) % n] === sign) {
      const j = (origin + s) % n;
      turn += Math.abs(kappa[j]) * ds;
      if (Math.abs(kappa[j]) > kMax) {
        kMax = Math.abs(kappa[j]);
        apex = j;
      }
      count++;
      s++;
    }
    if (count >= minRun && turn > 0.2) {
      corners.push({
        start: wrapIndex(i - pad, n),
        end: wrapIndex(i + count - 1 + pad, n),
        sign,
        minRadiusM: 1 / (kMax / upm),
        turn,
        apex,
      });
    }
  }
  const cornerSide = new Int8Array(n);
  for (const c of corners) for (let j = c.start; j !== wrapIndex(c.end + 1, n); j = (j + 1) % n) cornerSide[j] = c.sign;

  // nearest-sample search: coarse subset brute force + local refine
  const stride = Math.max(1, Math.round(n / 320));
  const nearest = (x: number, z: number) => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i += stride) {
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    for (let k = -stride; k <= stride; k++) {
      const i = wrapIndex(bi + k, n);
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return { i: bi, d: Math.sqrt(bd) };
  };

  // room on each side: distance from our edge to another part of the circuit's edge
  const cap = 60 * M;
  const roomL = new Float32Array(n).fill(cap);
  const roomR = new Float32Array(n).fill(cap);
  const cell = cap;
  const grid = new Map<string, number[]>();
  const key = (gx: number, gz: number) => gx + ',' + gz;
  for (let i = 0; i < n; i += 2) {
    const k = key(Math.floor(px[i] / cell), Math.floor(pz[i] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(px[i] / cell);
    const gz = Math.floor(pz[i] / cell);
    for (let ox = -1; ox <= 1; ox++)
      for (let oz = -1; oz <= 1; oz++) {
        const arr = grid.get(key(gx + ox, gz + oz));
        if (!arr) continue;
        for (const j of arr) {
          let dj = Math.abs(j - i);
          dj = Math.min(dj, n - dj);
          const dx = px[j] - px[i];
          const dz = pz[j] - pz[i];
          const d = Math.hypot(dx, dz);
          // "another part of the circuit": much further along the lap than it is away
          // (so the other leg of a hairpin counts, the same straight does not)
          if (dj * ds < 1.6 * d + 4 * meanHalf) continue;
          const lat = dx * rx[i] + dz * rz[i];
          const other = Math.max(hwL[j], hwR[j]);
          if (lat > 0) roomR[i] = Math.min(roomR[i], Math.max(0, d - hwR[i] - other));
          else roomL[i] = Math.min(roomL[i], Math.max(0, d - hwL[i] - other));
        }
      }
  }

  const poly: [number, number][] = [];
  for (let i = 0; i < n; i += 4) poly.push([px[i], pz[i]]);
  const infield = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };

  return {
    infield,
    n,
    px,
    py,
    pz,
    tx,
    tz,
    rx,
    rz,
    hwL,
    hwR,
    kappa,
    cornerSide,
    corners,
    roomL: smoothMin(roomL, Math.round((20 * upm) / ds)),
    roomR: smoothMin(roomR, Math.round((20 * upm) / ds)),
    M,
    upm,
    ds,
    length,
    meanHalf,
    hasRealWidths: hasRealWidths(circuit),
    pit: { centre: pitCentre, width: pitWidth, span: opts.pitSpan },
    bounds: { minX, maxX, minZ, maxZ, minY, maxY, meanY: sumY / n },
    nearest,
  };
}

/** Running minimum over ±k (so barriers ease in before a pinch point). */
function smoothMin(src: Float32Array, k: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = src[i];
    for (let j = -k; j <= k; j++) m = Math.min(m, src[wrapIndex(i + j, n)]);
    out[i] = m;
  }
  return out;
}

// --------------------------------------------------------------------------- //
// deterministic randomness + value noise
// --------------------------------------------------------------------------- //
export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
