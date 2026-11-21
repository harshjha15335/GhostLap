import type { CircuitGeometry } from '@/types';

/**
 * Circuit metadata derived purely from the geometry in the race bundles
 * (OpenF1 location trace of a real lap). Nothing here is hand-entered: corner
 * counts and straights are estimates from the curvature of that trace.
 */
export interface CircuitStats {
  /** lap length from the data, km */
  lengthKm: number;
  /** corners estimated from curvature (direction changes ≥ ~25° at radius < ~250 m) */
  corners: number;
  /** longest near-straight section (radius > ~700 m) */
  longestStraightKm: number;
  /** same, as a fraction of the lap */
  longestStraightFraction: number;
  /** lap fraction where that straight starts */
  longestStraightStart: number;
  /** elevation range, metres (from the trace's z) */
  elevationRangeM: number;
  /** lap fraction (0..1) of each detected corner's apex */
  cornerApexes: number[];
}

const CORNER_RADIUS_M = 250;
const CORNER_MIN_TURN_DEG = 25;
const STRAIGHT_RADIUS_M = 700;
const SMOOTH = 2;

const statsCache = new WeakMap<CircuitGeometry, CircuitStats>();

export function circuitStats(geometry: CircuitGeometry): CircuitStats {
  const hit = statsCache.get(geometry);
  if (hit) return hit;
  const pts = geometry.points;
  const n = pts.length;
  const empty: CircuitStats = {
    lengthKm: geometry.lengthKm,
    corners: 0,
    longestStraightKm: 0,
    longestStraightFraction: 0,
    longestStraightStart: 0,
    elevationRangeM: geometry.elevationRangeM,
    cornerApexes: [],
  };
  if (n < 10) return empty;

  // segment lengths (top-down x/z) → metres per render unit
  const seg = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    seg[i] = Math.hypot(b[0] - a[0], b[2] - a[2]);
    total += seg[i];
  }
  if (total <= 0) return empty;
  const mPerUnit = (geometry.lengthKm * 1000) / total;

  // signed heading change at each point, then smoothed curvature (rad / m)
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const c = pts[i];
    const q = pts[(i + 1) % n];
    const h1 = Math.atan2(c[2] - p[2], c[0] - p[0]);
    const h2 = Math.atan2(q[2] - c[2], q[0] - c[0]);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turn[i] = d;
  }
  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let th = 0;
    let len = 0;
    for (let j = -SMOOTH; j <= SMOOTH; j++) {
      const k = (i + j + n) % n;
      th += turn[k];
      len += seg[k] * mPerUnit;
    }
    kappa[i] = len > 0 ? th / len : 0;
  }

  // corners: runs of |κ| > 1/R with consistent sign and enough total turn
  const isCorner = (i: number) => Math.abs(kappa[i]) > 1 / CORNER_RADIUS_M;
  // start scanning from a non-corner point so runs don't wrap
  let start = 0;
  while (start < n && isCorner(start)) start++;
  if (start >= n) start = 0;
  const apexes: number[] = [];
  const cumFrac = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    cumFrac[i] = acc / total;
    acc += seg[i];
  }
  let i = 0;
  while (i < n) {
    const idx = (start + i) % n;
    if (!isCorner(idx)) {
      i++;
      continue;
    }
    const sign = Math.sign(kappa[idx]);
    let turnSum = 0;
    let apex = idx;
    let apexK = 0;
    while (i < n) {
      const k = (start + i) % n;
      if (!isCorner(k) || Math.sign(kappa[k]) !== sign) break;
      turnSum += turn[k];
      if (Math.abs(kappa[k]) > apexK) {
        apexK = Math.abs(kappa[k]);
        apex = k;
      }
      i++;
    }
    if (Math.abs(turnSum) * (180 / Math.PI) >= CORNER_MIN_TURN_DEG) apexes.push(cumFrac[apex]);
  }
  apexes.sort((a, b) => a - b);

  // longest straight: longest run (wrapping) with radius > STRAIGHT_RADIUS_M
  const straight = (k: number) => Math.abs(kappa[k]) < 1 / STRAIGHT_RADIUS_M;
  let best = 0;
  let bestStart = 0;
  let run = 0;
  let runStart = 0;
  for (let j = 0; j < 2 * n; j++) {
    const k = j % n;
    if (straight(k)) {
      if (run === 0) runStart = k;
      run += seg[k];
      if (run > best && run <= total) {
        best = run;
        bestStart = runStart;
      }
    } else run = 0;
  }
  const stats: CircuitStats = {
    lengthKm: geometry.lengthKm,
    corners: apexes.length,
    longestStraightKm: Math.round(best * mPerUnit) / 1000,
    longestStraightFraction: best / total,
    longestStraightStart: cumFrac[bestStart],
    elevationRangeM: geometry.elevationRangeM,
    cornerApexes: apexes,
  };
  statsCache.set(geometry, stats);
  return stats;
}

export interface SvgPathOptions {
  /** padding inside the square viewBox, in viewBox units (default 4% of size) */
  padding?: number;
  /** decimal places (default 1) */
  precision?: number;
  /** keep every k-th point (default: enough for ~200 points) */
  step?: number;
}

/**
 * Closed top-down SVG path ("M … L … Z") of the circuit, fitted and centred in a
 * `0 0 size size` viewBox (x → right, render z → down, so north is up).
 */
export function circuitSvgPath(geometry: CircuitGeometry, size = 100, opts: SvgPathOptions = {}): string {
  const pts = geometry.points;
  if (!pts.length) return '';
  const pad = opts.padding ?? size * 0.04;
  const prec = opts.precision ?? 1;
  const step = Math.max(1, opts.step ?? Math.floor(pts.length / 200));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, , z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ) || 1;
  const s = (size - 2 * pad) / span;
  const ox = (size - (maxX - minX) * s) / 2;
  const oz = (size - (maxZ - minZ) * s) / 2;
  const f = (v: number) => {
    const r = v.toFixed(prec);
    return r.includes('.') ? r.replace(/\.?0+$/, '') : r;
  };
  let d = '';
  for (let i = 0; i < pts.length; i += step) {
    const [x, , z] = pts[i];
    d += `${i === 0 ? 'M' : 'L'}${f(ox + (x - minX) * s)} ${f(oz + (z - minZ) * s)}`;
  }
  return d + 'Z';
}

/** Start/finish point in the same coordinates as circuitSvgPath (for a marker). */
export function circuitSvgStart(geometry: CircuitGeometry, size = 100, padding = size * 0.04): [number, number] {
  const pts = geometry.points;
  if (!pts.length) return [size / 2, size / 2];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...zs) - minZ;
  const s = (size - 2 * padding) / (Math.max(w, h) || 1);
  return [(size - w * s) / 2 + (pts[0][0] - minX) * s, (size - h * s) / 2 + (pts[0][2] - minZ) * s];
}
