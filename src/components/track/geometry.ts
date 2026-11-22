import * as THREE from 'three';
import { Mesher, type V3 } from './mesher';
import { fbm, rng, smoothstep, valueNoise, wrapIndex, type TrackModel } from './trackModel';

/**
 * Geometry builders for <CircuitEnvironment>. Everything is generated from the
 * TrackModel (render space, right = tangent × up) and merged per material.
 */

export const SECTOR_LINE_COLORS = ['#FF1E1E', '#2F7BFF', '#FFD400'];

const C = (hex: string) => new THREE.Color(hex);
export const PALETTE = {
  asphalt: C('#3a3e46'),
  asphaltPit: C('#454a53'),
  apron: C('#5d626b'),
  gravel: C('#b9a582'),
  grass: C('#3f6a36'),
  grassMown: C('#4b7a3f'),
  kerbRed: C('#d0142a'),
  kerbWhite: C('#eef0f3'),
  line: C('#e9ecf0'),
  black: C('#121316'),
  wall: C('#c9ced6'),
  retaining: C('#5f646c'),
  steel: C('#8f959c'),
  building: C('#a3a9b2'),
  buildingDark: C('#20252d'),
  roof: C('#b9bec6'),
  standFrame: C('#6c737e'),
  plinth: C('#262b33'),
  plinthTop: C('#1d2128'),
  urban: C('#575c63'),
};
const BOARDS = ['#1d4f91', '#1f6b3a', '#3a2c5c', '#26292e', '#e6e8eb', '#0f3d63', '#6b1f2a'].map(C);
const CROWD = ['#d8dce2', '#c23b3b', '#2f6fb3', '#e0b43a', '#3f8f55', '#7d4fa8', '#e3e5e8', '#ff7a1a'].map(C);

export interface Side {
  /** asphalt edge, paved apron outer edge, gravel outer edge, barrier — offsets from the centreline */
  edge: Float32Array;
  apron: Float32Array;
  gravel: Float32Array;
  barrier: Float32Array;
  /** outermost thing built on this side (terrain is kept flat under it) */
  far: Float32Array;
  /** kerb widths (inside-of-corner and exit kerbs) */
  kerb: Float32Array;
}

export interface Layout {
  L: Side;
  R: Side;
  /** pit lane per sample (NaN outside): centre offset and blend 0..1 (1 = full offset) */
  pitCentre: Float32Array;
  pitBlend: Float32Array;
  pitN: number;
  /** grandstands: sample ranges + side */
  stands: { i0: number; i1: number; side: 1 | -1 }[];
}

/** sample index distance from the start/finish line */
const fromLine = (i: number, n: number) => Math.min(i, n - i);

export function at(m: TrackModel, i: number, off: number, lift = 0): V3 {
  return [m.px[i] + m.rx[i] * off, m.py[i] + lift, m.pz[i] + m.rz[i] * off];
}

function movingAvg(src: Float32Array, k: number): Float32Array {
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

const forRange = (i0: number, i1: number, n: number, fn: (i: number, k: number) => void) => {
  let k = 0;
  for (let i = i0; ; i = (i + 1) % n) {
    fn(i, k++);
    if (i === i1 || k > n) break;
  }
};

export function buildLayout(m: TrackModel, quality: 'high' | 'low'): Layout {
  const { n, M, upm, ds } = m;
  const metres = (x: number) => Math.max(1, Math.round((x * upm) / ds)); // real metres → samples
  const mk = () => ({
    edge: new Float32Array(n),
    apron: new Float32Array(n),
    gravel: new Float32Array(n),
    barrier: new Float32Array(n),
    far: new Float32Array(n),
    kerb: new Float32Array(n),
  });
  const L = mk();
  const R = mk();
  L.edge.set(m.hwL);
  R.edge.set(m.hwR);

  // targets per sample before smoothing
  const apronT = [new Float32Array(n).fill(1.2 * M), new Float32Array(n).fill(1.2 * M)];
  const gravelT = [new Float32Array(n), new Float32Array(n)];
  const grassT = [new Float32Array(n).fill(7 * M), new Float32Array(n).fill(7 * M)];
  const kerbT = [new Float32Array(n), new Float32Array(n)];
  const exitPad = metres(30);
  const taper = metres(14);
  for (const c of m.corners) {
    const inside = c.sign > 0 ? 1 : 0;
    const outside = 1 - inside;
    const len = wrapIndex(c.end - c.start, n) + 1;
    const fast = c.minRadiusM > 45;
    forRange(c.start, c.end, n, (i, k) => {
      const tp = Math.min(1, Math.min(k, len - 1 - k) / taper);
      kerbT[inside][i] = Math.max(kerbT[inside][i], 1.9 * M * tp);
      apronT[inside][i] = Math.max(apronT[inside][i], 4 * M);
      grassT[inside][i] = Math.max(grassT[inside][i], 10 * M);
      // exit kerb on the outside from the apex on
      if (k > len * 0.45) kerbT[outside][i] = Math.max(kerbT[outside][i], 1.3 * M * Math.min(1, (len - 1 - k) / taper));
    });
    // outside: run-off from the middle of the corner to beyond its exit
    const o0 = wrapIndex(c.start + Math.round(len * 0.25), n);
    const o1 = wrapIndex(c.end + exitPad, n);
    const olen = wrapIndex(o1 - o0, n) + 1;
    const depth = (fast ? 26 : 8) * M * Math.min(1.4, Math.max(0.6, c.turn / 1.4));
    forRange(o0, o1, n, (i, k) => {
      const tp = smoothstep(0, 1, Math.min(k, olen - 1 - k) / (olen * 0.3));
      apronT[outside][i] = Math.max(apronT[outside][i], (fast ? 4 : 16) * M * Math.max(0.3, tp));
      if (fast) gravelT[outside][i] = Math.max(gravelT[outside][i], depth * tp);
      grassT[outside][i] = Math.max(grassT[outside][i], 4 * M);
    });
  }

  const sm = metres(12);
  const pitN = Math.round(m.pit.span * n);
  const pitCentre = new Float32Array(n).fill(NaN);
  const pitBlend = new Float32Array(n);
  const sides = [L, R];
  for (let s = 0; s < 2; s++) {
    const S = sides[s];
    const room = s === 0 ? m.roomL : m.roomR;
    const ap = movingAvg(apronT[s], sm);
    const gr = movingAvg(gravelT[s], sm);
    const gs = movingAvg(grassT[s], sm);
    S.kerb.set(movingAvg(kerbT[s], 1));
    const bar = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const e = S.edge[i];
      const maxB = e + Math.max(1.4 * M, room[i] * 0.48);
      bar[i] = Math.min(maxB, e + ap[i] + gr[i] + gs[i] + 0.8 * M);
    }
    const b = movingAvg(bar, metres(8));
    for (let i = 0; i < n; i++) {
      const e = S.edge[i];
      const bi = Math.max(e + 1.2 * M, Math.min(b[i], bar[i] + 0.6 * M));
      const a = Math.min(e + ap[i], bi - 0.3 * M);
      const g = Math.min(a + gr[i], bi - 0.8 * M);
      S.apron[i] = Math.max(e, a);
      S.gravel[i] = Math.max(S.apron[i], g);
      S.barrier[i] = bi;
      S.far[i] = bi + 0.6 * M;
      S.kerb[i] = Math.min(S.kerb[i], Math.max(0, bi - e - 0.4 * M));
    }
  }

  // pit lane on the right around the line
  const T = Math.max(2, Math.round(pitN * 0.3));
  const w = m.pit.width;
  for (let i = 0; i < n; i++) {
    const di = fromLine(i, n);
    if (di > pitN) continue;
    const t = smoothstep(0, 1, (pitN - di) / T);
    const e = R.edge[i];
    const c = e + 0.3 * w + (m.pit.centre - e - 0.3 * w) * t;
    pitCentre[i] = c;
    pitBlend[i] = t;
    R.kerb[i] = 0;
    R.apron[i] = e;
    R.gravel[i] = e;
    R.barrier[i] = Math.max(e + 0.2 * M, c - w / 2 - 0.15 * M);
    const core = di < pitN * 0.62;
    R.far[i] = c + w / 2 + (core ? 17 * M : 0.8 * M);
  }

  // grandstands: opposite the pits on the main straight + outside the biggest corners
  const stands: Layout['stands'] = [];
  const standDepth = 17 * M;
  const sMain = Math.round(pitN * 0.55);
  stands.push({ i0: wrapIndex(-Math.round(sMain * 0.7), n), i1: sMain, side: -1 });
  const big = [...m.corners].sort((a, b) => b.turn - a.turn).slice(0, quality === 'high' ? 5 : 3);
  for (const c of big) {
    const outSide = (c.sign > 0 ? -1 : 1) as 1 | -1;
    const S = outSide > 0 ? R : L;
    const room = outSide > 0 ? m.roomR : m.roomL;
    const len = wrapIndex(c.end - c.start, n) + 1;
    const i0 = wrapIndex(c.start + Math.round(len * 0.2), n);
    const i1 = wrapIndex(c.start + Math.round(len * 0.8), n);
    if (fromLine(i0, n) < pitN * 1.2 || fromLine(i1, n) < pitN * 1.2) continue;
    let ok = true;
    forRange(i0, i1, n, (i) => {
      if (room[i] < S.barrier[i] - S.edge[i] + standDepth + 4 * M) ok = false;
    });
    if (ok && len > 6) stands.push({ i0, i1, side: outSide });
  }
  for (const st of stands) {
    const S = st.side > 0 ? R : L;
    forRange(st.i0, st.i1, n, (i) => {
      S.far[i] = Math.max(S.far[i], S.barrier[i] + 1.5 * M + standDepth);
    });
  }
  return { L, R, pitCentre, pitBlend, pitN, stands };
}

// --------------------------------------------------------------------------- //
// terrain: diorama block following the track's elevation
// --------------------------------------------------------------------------- //
export interface Terrain {
  geometry: THREE.BufferGeometry;
  heightAt(x: number, z: number): number;
  distAt(x: number, z: number): number;
  rect: { x0: number; x1: number; z0: number; z1: number };
  bottom: number;
}

export function buildTerrain(m: TrackModel, lay: Layout, opts: { quality: 'high' | 'low'; seed: number; urban: boolean }): Terrain {
  const { bounds: b, M } = m;
  const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const margin = ext * 0.14 + 10;
  const x0 = b.minX - margin, x1 = b.maxX + margin, z0 = b.minZ - margin, z1 = b.maxZ + margin;
  const res = opts.quality === 'high' ? 230 : 130;
  const cell = Math.max(x1 - x0, z1 - z0) / res;
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const N = nx * nz;
  const base = new Float32Array(N);
  const dist = new Float32Array(N);
  const far = new Float32Array(N);
  const stamp = new Float32Array(N).fill(Infinity);
  const drop = 0.12;

  for (let gz = 0; gz < nz; gz++)
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const { i, d } = m.nearest(x, z);
      base[k] = m.py[i];
      dist[k] = d;
      const lat = (x - m.px[i]) * m.rx[i] + (z - m.pz[i]) * m.rz[i];
      far[k] = lat > 0 ? lay.R.far[i] : lay.L.far[i];
    }
  // keep the ground under everything built along the track (handles crossovers too)
  for (let i = 0; i < m.n; i++) {
    const reach = Math.max(lay.L.far[i], lay.R.far[i]) + cell;
    const y = m.py[i] - drop;
    const cx = Math.round((m.px[i] - x0) / cell);
    const cz = Math.round((m.pz[i] - z0) / cell);
    const r = Math.ceil(reach / cell);
    for (let oz = -r; oz <= r; oz++)
      for (let ox = -r; ox <= r; ox++) {
        const gx = cx + ox, gz = cz + oz;
        if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) continue;
        const wx = x0 + gx * cell - m.px[i];
        const wz = z0 + gz * cell - m.pz[i];
        const lat = wx * m.rx[i] + wz * m.rz[i];
        const lon = wx * m.tx[i] + wz * m.tz[i];
        const lim = (lat > 0 ? lay.R.far[i] : lay.L.far[i]) + cell * 0.75;
        if (Math.abs(lat) <= lim && Math.abs(lon) <= m.ds * 2 + cell) {
          const k = gz * nx + gx;
          if (y < stamp[k]) stamp[k] = y;
        }
      }
  }
  // blur the nearest-track height so the land between two levels is a slope, not a cliff
  let sm = base;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(N);
    const r = 3;
    for (let gz = 0; gz < nz; gz++)
      for (let gx = 0; gx < nx; gx++) {
        let acc = 0, cnt = 0;
        for (let o = -r; o <= r; o++) {
          const xx = gx + o;
          if (xx < 0 || xx >= nx) continue;
          acc += sm[gz * nx + xx];
          cnt++;
        }
        out[gz * nx + gx] = acc / cnt;
      }
    const out2 = new Float32Array(N);
    for (let gz = 0; gz < nz; gz++)
      for (let gx = 0; gx < nx; gx++) {
        let acc = 0, cnt = 0;
        for (let o = -r; o <= r; o++) {
          const zz = gz + o;
          if (zz < 0 || zz >= nz) continue;
          acc += out[zz * nx + gx];
          cnt++;
        }
        out2[gz * nx + gx] = acc / cnt;
      }
    sm = out2;
  }

  const elev = b.maxY - b.minY;
  const amp = 1.2 + elev * 0.25 + ext * 0.012;
  const H = new Float32Array(N);
  const edgeLevel = b.meanY - drop - amp * 0.15;
  const relief = (x: number, z: number) => (fbm(x / (ext * 0.18), z / (ext * 0.18), opts.seed, 4) - 0.45) * amp;
  for (let k = 0; k < N; k++) {
    const gx = k % nx, gz = Math.floor(k / nx);
    const x = x0 + gx * cell, z = z0 + gz * cell;
    const near = base[k] - drop;
    const t = smoothstep(far[k], far[k] + 14 * M + ext * 0.05, dist[k]);
    let h = near * (1 - t) + (sm[k] - drop + relief(x, z)) * t;
    // level the rim so the block reads as a clean cut slab (Boxlane-style diorama)
    const rim = Math.min(x - x0, x1 - x, z - z0, z1 - z) / (ext * 0.07);
    h = edgeLevel + (h - edgeLevel) * smoothstep(0, 1, rim);
    if (stamp[k] < Infinity) h = Math.min(h, stamp[k]);
    H[k] = h;
  }
  let minH = Infinity;
  for (let k = 0; k < N; k++) minH = Math.min(minH, H[k]);
  const bottom = minH - Math.max(3, ext * 0.035);

  // colours: grass with mown bands near the track, fields / woods / town patches further out
  const geo = new Mesher();
  const col = new THREE.Color();
  const tmp = new THREE.Color();
  const colorAt = (x: number, z: number, d: number) => {
    const s = opts.seed;
    const n1 = fbm(x / 9, z / 9, s + 3, 3);
    const field = valueNoise(x / 26, z / 26, s + 7);
    col.copy(PALETTE.grass).lerp(PALETTE.grassMown, smoothstep(0.35, 0.65, n1));
    if (field > 0.62) col.lerp(tmp.set('#6c7a3e'), 0.55); // dry fields
    else if (field < 0.28) col.lerp(tmp.set('#2a4a2a'), 0.6); // woods
    const town = valueNoise(x / 40, z / 40, s + 11);
    if (opts.urban || (town > 0.7 && !m.infield(x, z))) col.lerp(PALETTE.urban, opts.urban ? 0.75 : 0.5 * smoothstep(0.7, 0.8, town));
    // darker far from the circuit so the block reads as a stage
    col.multiplyScalar(1 - 0.3 * smoothstep(ext * 0.15, ext * 0.6, d));
    return col;
  };
  const vtx: V3[] = new Array(N);
  for (let k = 0; k < N; k++) vtx[k] = [x0 + (k % nx) * cell, H[k], z0 + Math.floor(k / nx) * cell];
  // per-cell quads (flat colour per cell keeps it low-poly; normals smooth via indexed pass below)
  const pos: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < N; k++) {
    const v = vtx[k];
    pos.push(v[0], v[1], v[2]);
    const c = colorAt(v[0], v[2], dist[k]);
    cols.push(c.r, c.g, c.b);
  }
  for (let gz = 0; gz < nz - 1; gz++)
    for (let gx = 0; gx < nx - 1; gx++) {
      const a = gz * nx + gx;
      const bb = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, c, bb, bb, c, d);
    }
  // plinth sides (the cut faces of the block)
  const side = (k0: number, k1: number) => {
    const A = vtx[k0], B = vtx[k1];
    geo.quad([A[0], bottom, A[2]], [B[0], bottom, B[2]], A, B, PALETTE.plinth);
  };
  for (let gx = 0; gx < nx - 1; gx++) {
    side(gx, gx + 1);
    side((nz - 1) * nx + gx + 1, (nz - 1) * nx + gx);
  }
  for (let gz = 0; gz < nz - 1; gz++) {
    side((gz + 1) * nx, gz * nx);
    side(gz * nx + nx - 1, (gz + 1) * nx + nx - 1);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  top.setIndex(idx);
  top.computeVertexNormals();
  const sides = geo.geometry();
  const merged = mergeTwo(top.toNonIndexed(), sides);
  top.dispose();
  sides.dispose();

  const sample = (arr: Float32Array, x: number, z: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cell));
    const gx = Math.floor(fx), gz = Math.floor(fz);
    const u = fx - gx, v = fz - gz;
    const k = gz * nx + gx;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + nx] * (1 - u) + arr[k + nx + 1] * u) * v;
  };
  return {
    geometry: merged,
    heightAt: (x, z) => sample(H, x, z),
    distAt: (x, z) => sample(dist, x, z),
    rect: { x0, x1, z0, z1 },
    bottom,
  };
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const A = a.getAttribute(name) as THREE.BufferAttribute;
    const B = b.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array as Float32Array, 0);
    arr.set(B.array as Float32Array, A.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  out.computeBoundingSphere();
  return out;
}

// --------------------------------------------------------------------------- //
// asphalt (track + pit lane), with UVs for the grain texture
// --------------------------------------------------------------------------- //
export function buildAsphalt(m: TrackModel, lay: Layout): THREE.BufferGeometry {
  const { n } = m;
  const g = new Mesher(true);
  const vScale = 1 / (m.meanHalf * 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const v0 = i * m.ds * vScale, v1 = (i + 1) * m.ds * vScale;
    g.quad(at(m, i, -m.hwL[i], 0.02), at(m, i, m.hwR[i], 0.02), at(m, j, -m.hwL[j], 0.02), at(m, j, m.hwR[j], 0.02), PALETTE.asphalt, true, [0, 1, v0, v1]);
    const c0 = lay.pitCentre[i], c1 = lay.pitCentre[j];
    if (!Number.isNaN(c0) && !Number.isNaN(c1)) {
      const hw = m.pit.width / 2;
      g.quad(at(m, i, c0 - hw, 0.015), at(m, i, c0 + hw, 0.015), at(m, j, c1 - hw, 0.015), at(m, j, c1 + hw, 0.015), PALETTE.asphaltPit, true, [0, 0.4, v0, v1]);
    }
  }
  return g.geometry();
}

/** Paved apron, gravel and grass verges from each asphalt edge out to the barrier. */
export function buildVerges(m: TrackModel, lay: Layout, seed: number): THREE.BufferGeometry {
  const { n } = m;
  const g = new Mesher();
  const grass = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const s of [-1, 1] as const) {
      const S = s > 0 ? lay.R : lay.L;
      const band = (o0i: number, o0j: number, o1i: number, o1j: number, c: THREE.Color, lift: number) => {
        if (o1i - o0i < 1e-3 && o1j - o0j < 1e-3) return;
        const a = at(m, i, s * o0i, lift), b = at(m, i, s * o1i, lift);
        const cc = at(m, j, s * o0j, lift), d = at(m, j, s * o1j, lift);
        if (s > 0) g.quad(a, b, cc, d, c, true);
        else g.quad(b, a, d, cc, c, true);
      };
      band(S.edge[i] - 0.05, S.edge[j] - 0.05, S.apron[i], S.apron[j], PALETTE.apron, 0.012);
      band(S.apron[i], S.apron[j], S.gravel[i], S.gravel[j], PALETTE.gravel, 0.01);
      const p = at(m, i, s * S.barrier[i]);
      grass.copy(PALETTE.grassMown).lerp(PALETTE.grass, valueNoise(p[0] / 6, p[2] / 6, seed));
      band(S.gravel[i], S.gravel[j], S.barrier[i] + 0.4 * m.M, S.barrier[j] + 0.4 * m.M, grass, 0.008);
      // pit side: grass strip between pit wall and lane already covered; lane surroundings
      if (s > 0 && !Number.isNaN(lay.pitCentre[i]) && !Number.isNaN(lay.pitCentre[j])) {
        const ow = m.pit.width / 2;
        band(lay.pitCentre[i] + ow, lay.pitCentre[j] + ow, S.far[i], S.far[j], PALETTE.apron, 0.01);
      }
    }
  }
  return g.geometry();
}

/** Red/white kerbs on the inside of corners and exit kerbs, ramped slightly. */
export function buildKerbs(m: TrackModel, lay: Layout): THREE.BufferGeometry {
  const { n, M } = m;
  const g = new Mesher();
  const stripe = Math.max(1, Math.round((3 * m.upm) / m.ds));
  for (const s of [-1, 1] as const) {
    const S = s > 0 ? lay.R : lay.L;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const wi = S.kerb[i], wj = S.kerb[j];
      if (wi < 0.02 * M && wj < 0.02 * M) continue;
      const c = Math.floor(i / stripe) % 2 ? PALETTE.kerbWhite : PALETTE.kerbRed;
      const lip = 0.18 * M;
      const a = at(m, i, s * (S.edge[i] - 0.02), 0.03), b = at(m, i, s * (S.edge[i] + wi), 0.03 + lip * Math.min(1, wi / M));
      const cc = at(m, j, s * (S.edge[j] - 0.02), 0.03), d = at(m, j, s * (S.edge[j] + wj), 0.03 + lip * Math.min(1, wj / M));
      if (s > 0) g.quad(a, b, cc, d, c, true);
      else g.quad(b, a, d, cc, c, true);
    }
  }
  return g.geometry();
}

/** White edge lines, pit-lane lines, the chequered line, grid slots and sector lines. */
export function buildLines(m: TrackModel, lay: Layout, sectors: [number, number] | null): THREE.BufferGeometry {
  const { n, M } = m;
  const g = new Mesher();
  const lw = Math.max(0.06, 0.45 * M);
  const flat = (s: number, a: V3, b: V3, c: V3, d: V3, col: THREE.Color) => (s > 0 ? g.quad(a, b, c, d, col, true) : g.quad(b, a, d, c, col, true));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const s of [-1, 1] as const) {
      const hw = s > 0 ? m.hwR : m.hwL;
      flat(s, at(m, i, s * (hw[i] - lw), 0.04), at(m, i, s * hw[i], 0.04), at(m, j, s * (hw[j] - lw), 0.04), at(m, j, s * hw[j], 0.04), PALETTE.line);
    }
    const c0 = lay.pitCentre[i], c1 = lay.pitCentre[j];
    if (!Number.isNaN(c0) && !Number.isNaN(c1)) {
      const hw = m.pit.width / 2;
      for (const e of [-hw, hw - lw * 0.7])
        g.quad(at(m, i, c0 + e, 0.03), at(m, i, c0 + e + lw * 0.7, 0.03), at(m, j, c1 + e, 0.03), at(m, j, c1 + e + lw * 0.7, 0.03), PALETTE.line, true);
      // fast lane / working lane divider (dashed)
      if (lay.pitBlend[i] > 0.99 && Math.floor(i / 2) % 2 === 0)
        g.quad(at(m, i, c0 - lw * 0.3, 0.03), at(m, i, c0 + lw * 0.3, 0.03), at(m, j, c1 - lw * 0.3, 0.03), at(m, j, c1 + lw * 0.3, 0.03), PALETTE.line, true);
    }
  }
  // transverse marks: chequered start line, grid slots, sector lines
  const across = (f: number, lo: number, hi: number, depth: number, color: (k: number) => THREE.Color, cols = 1) => {
    const u = ((f % 1) + 1) % 1;
    const fi = u * n;
    const i = Math.floor(fi) % n;
    const d = depth / 2;
    const P = (off: number, along: number): V3 => [
      m.px[i] + m.rx[i] * off + m.tx[i] * along,
      m.py[i] + 0.05,
      m.pz[i] + m.rz[i] * off + m.tz[i] * along,
    ];
    const rows = cols > 1 ? 2 : 1;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const o0 = lo + ((hi - lo) * k) / cols, o1 = lo + ((hi - lo) * (k + 1)) / cols;
        const a0 = -d + (2 * d * r) / rows, a1 = -d + (2 * d * (r + 1)) / rows;
        g.quad(P(o0, a0), P(o1, a0), P(o0, a1), P(o1, a1), color(k + r), true);
      }
  };
  across(0, -m.hwL[0], m.hwR[0], 1.4 * M, (k) => (k % 2 ? PALETTE.black : PALETTE.line), 14);
  // grid slots match Cars.tsx's lap-1 staging (≈0.95 units per slot, staggered ±0.55)
  for (let k = 0; k < 22; k++) {
    const back = k * 0.95 + 1.2;
    const lane = k % 2 ? -0.55 : 0.55;
    across(-back / m.length, lane - 0.45, lane + 0.45, 0.09, () => PALETTE.line);
  }
  if (sectors) {
    sectors.forEach((f, k) => {
      const i = Math.floor(f * n) % n;
      across(f, -m.hwL[i], m.hwR[i], 0.18, () => new THREE.Color(SECTOR_LINE_COLORS[k + 1]));
    });
  }
  return g.geometry();
}

/** Barrier walls with blank hoarding colours and a steel top rail; feet reach the terrain. */
export function buildBarriers(m: TrackModel, lay: Layout, terrain: Terrain): THREE.BufferGeometry {
  const { n, M, upm } = m;
  const g = new Mesher();
  const h = 1.3 * M;
  const th = 0.35 * M;
  const board = Math.max(1, Math.round((48 * upm) / m.ds));
  for (const s of [-1, 1] as const) {
    const S = s > 0 ? lay.R : lay.L;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (s > 0 && (!Number.isNaN(lay.pitCentre[i]) || !Number.isNaN(lay.pitCentre[j]))) continue; // pit wall instead
      const oi = s * S.barrier[i], oj = s * S.barrier[j];
      const oi2 = s * (S.barrier[i] + th), oj2 = s * (S.barrier[j] + th);
      const pi = at(m, i, oi), pj = at(m, j, oj);
      const fi = Math.min(pi[1] - 0.5, terrain.heightAt(pi[0], pi[2]) - 0.1) - pi[1];
      const fj = Math.min(pj[1] - 0.5, terrain.heightAt(pj[0], pj[2]) - 0.1) - pj[1];
      const face = BOARDS[(Math.floor(i / board) + (s > 0 ? 3 : 0)) % BOARDS.length];
      // board face above the verge, concrete retaining wall below it (feet reach the terrain)
      g.quad(at(m, i, oi, 0), at(m, j, oj, 0), at(m, i, oi, h), at(m, j, oj, h), face);
      if (fi < -0.05 || fj < -0.05) g.quad(at(m, i, oi, fi), at(m, j, oj, fj), at(m, i, oi, 0), at(m, j, oj, 0), PALETTE.retaining);
      g.quad(at(m, i, oi, h), at(m, j, oj, h), at(m, i, oi2, h), at(m, j, oj2, h), PALETTE.steel);
      g.quad(at(m, i, oi2, fi), at(m, j, oj2, fj), at(m, i, oi2, h), at(m, j, oj2, h), PALETTE.wall);
    }
  }
  return g.geometry();
}

/** Profile extruded along a sample range on one side: profile = [lateral from base, height][]. */
function extrude(
  g: Mesher,
  m: TrackModel,
  i0: number,
  i1: number,
  side: 1 | -1,
  baseAt: (i: number) => number,
  profile: [number, number][],
  colour: (seg: number, i: number) => THREE.Color,
  closeEnds = true,
) {
  const n = m.n;
  const pt = (i: number, p: [number, number]): V3 => at(m, i, side * (baseAt(i) + p[0]), p[1]);
  let prev = -1;
  forRange(i0, i1, n, (i) => {
    if (prev >= 0) {
      for (let k = 0; k < profile.length - 1; k++)
        g.quad(pt(prev, profile[k]), pt(i, profile[k]), pt(prev, profile[k + 1]), pt(i, profile[k + 1]), colour(k, i));
    }
    prev = i;
  });
  if (closeEnds) {
    for (const i of [i0, i1]) {
      // fan the profile into quads down to its first point's height (simple caps)
      for (let k = 1; k < profile.length - 1; k++) {
        const a = pt(i, profile[0]);
        const b = pt(i, profile[k]);
        const c = pt(i, profile[k + 1]);
        g.quad(a, b, a, c, colour(-1, i));
      }
    }
  }
}

export interface Structures {
  geometry: THREE.BufferGeometry;
  /** start lights on the gantry (world positions) */
  lights: V3[];
}

/** Pit wall, pit building, grandstands and the start/finish gantry. */
export function buildStructures(m: TrackModel, lay: Layout, quality: 'high' | 'low', seed: number): Structures {
  const { n, M } = m;
  const g = new Mesher();
  const R = rng(seed ^ 0x5bd1e995);
  const pitN = lay.pitN;
  const w = m.pit.width;

  // pit wall between the track and the pit lane
  // (only where the lane has split from the track; the tapers stay open)
  const pwN = pitN - Math.ceil(Math.max(2, Math.round(pitN * 0.3)) * 0.55);
  extrude(g, m, wrapIndex(-pwN, n), pwN, 1, (i) => lay.R.barrier[i], [[0, -0.3], [0, 1.1 * M], [0.3 * M, 1.1 * M], [0.3 * M, -0.3]], (k) => (k === 1 ? PALETTE.steel : PALETTE.wall));

  // pit building: garages facing the lane, offices above, light roof
  const core = Math.round(pitN * 0.62);
  const b0 = wrapIndex(-core, n);
  const base = (i: number) => lay.pitCentre[i] + w / 2 + 0.5 * M;
  const garage = Math.max(1, Math.round((6 * m.upm) / m.ds));
  extrude(
    g,
    m,
    b0,
    core,
    1,
    base,
    [[0, -0.4], [0, 4.5 * M], [0, 5 * M], [-1.5 * M, 5.2 * M], [-1.5 * M, 9.5 * M], [14 * M, 9.5 * M], [14 * M, -0.4]],
    (k, i) => {
      if (k === 0) return Math.floor(i / garage) % 4 === 0 ? PALETTE.building : PALETTE.buildingDark;
      if (k === 3) return C('#2b3a4f'); // glazing
      if (k === 4) return PALETTE.roof;
      return PALETTE.building;
    },
  );

  // outer pit-lane wall where the building does not close it off
  const laneOut = (i: number) => lay.pitCentre[i] + w / 2 + 0.3 * M;
  const wallProf: [number, number][] = [[0, -0.3], [0, 1.1 * M], [0.3 * M, 1.1 * M], [0.3 * M, -0.3]];
  const wallCol = (k: number) => (k === 1 ? PALETTE.steel : PALETTE.wall);
  extrude(g, m, core, pitN, 1, laneOut, wallProf, wallCol);
  extrude(g, m, wrapIndex(-pitN, n), wrapIndex(-core, n), 1, laneOut, wallProf, wallCol);

  // grandstands: stepped seating with a cantilever roof; crowd specks in the seats
  for (const st of lay.stands) {
    const S = st.side > 0 ? lay.R : lay.L;
    const seats = 15 * M;
    const rows = quality === 'high' ? 6 : 3;
    const prof: [number, number][] = [[0, -0.4], [0, 1.4 * M]];
    for (let r = 0; r < rows; r++) {
      const x = ((r + 1) / rows) * seats;
      const y = 1.4 * M + ((r + 1) / rows) * 9 * M;
      prof.push([x - seats / rows, y], [x, y]);
    }
    prof.push([seats, -0.4]);
    const crowdSeg = Math.max(1, Math.round((5 * m.upm) / m.ds));
    extrude(g, m, st.i0, st.i1, st.side, (i) => S.barrier[i] + 1.5 * M, prof, (k, i) => {
      if (k <= 0 || k === prof.length - 2) return PALETTE.standFrame;
      if (k % 2 === 1) return PALETTE.standFrame; // risers
      return CROWD[(Math.floor(i / crowdSeg) * 7 + k * 3 + Math.floor(R() * 2)) % CROWD.length];
    });
    // roof
    extrude(g, m, st.i0, st.i1, st.side, (i) => S.barrier[i] + 1.5 * M, [[2 * M, 13.5 * M], [seats + 0.5 * M, 12.5 * M]], () => PALETTE.roof, false);
    // roof columns
    const colStep = Math.max(2, Math.round((25 * m.upm) / m.ds));
    forRange(st.i0, st.i1, n, (i, k) => {
      if (k % colStep !== 0) return;
      const p = at(m, i, st.side * (S.barrier[i] + 1.5 * M + seats * 0.98), 0);
      g.box([p[0], p[1] + 6.5 * M, p[2]], m.tx[i], m.tz[i], [0.25 * M, 6.5 * M, 0.25 * M], PALETTE.standFrame);
    });
  }

  // start/finish gantry
  const lights: V3[] = [];
  const fx = m.tx[0], fz = m.tz[0];
  const left = Math.min(lay.L.barrier[0], m.hwL[0] + 1.2 * M);
  const right = m.hwR[0] + 0.6 * M;
  const ph = 7.5 * M;
  for (const off of [-left, right]) {
    const p = at(m, 0, off);
    g.box([p[0], p[1] + ph / 2, p[2]], fx, fz, [0.35 * M, ph / 2, 0.35 * M], PALETTE.steel);
  }
  const span = left + right;
  const mid = at(m, 0, (right - left) / 2, ph);
  const blocks = 16;
  for (let k = 0; k < blocks; k++) {
    for (let r = 0; r < 2; r++) {
      const off = -span / 2 + ((k + 0.5) / blocks) * span;
      const c: V3 = [mid[0] + m.rx[0] * off, mid[1] + (r - 0.5) * 0.9 * M, mid[2] + m.rz[0] * off];
      g.box(c, fx, fz, [span / blocks / 2, 0.45 * M, 0.3 * M], (k + r) % 2 ? PALETTE.black : PALETTE.kerbWhite);
    }
  }
  for (let k = 0; k < 5; k++) {
    const off = (k - 2) * 1.1 * M + (right - left) / 2;
    const p = at(m, 0, off, ph - 1.6 * M);
    lights.push([p[0] - fx * 0.35 * M, p[1], p[2] - fz * 0.35 * M]);
  }
  return { geometry: g.geometry(), lights };
}

// --------------------------------------------------------------------------- //
// surroundings: instanced trees + building blocks
// --------------------------------------------------------------------------- //
export interface Props {
  trees: { matrices: THREE.Matrix4[]; colors: THREE.Color[] };
  buildings: { matrices: THREE.Matrix4[]; colors: THREE.Color[] };
}

export function scatterProps(
  m: TrackModel,
  lay: Layout,
  terrain: Terrain,
  opts: { quality: 'high' | 'low'; seed: number; urban: boolean },
): Props {
  const R = rng(opts.seed);
  const { x0, x1, z0, z1 } = terrain.rect;
  const P = m.upm * 1.6; // prop scale: real metres, mildly exaggerated
  const maxTrees = opts.quality === 'high' ? 2600 : 700;
  const maxBuild = opts.quality === 'high' ? 520 : 170;
  const trees: Props['trees'] = { matrices: [], colors: [] };
  const buildings: Props['buildings'] = { matrices: [], colors: [] };
  const o = new THREE.Object3D();
  const clearance = (x: number, z: number) => {
    const { i, d } = m.nearest(x, z);
    const lat = (x - m.px[i]) * m.rx[i] + (z - m.pz[i]) * m.rz[i];
    return d - (lat > 0 ? lay.R.far[i] : lay.L.far[i]);
  };
  const inside = (x: number, z: number, pad: number) => x > x0 + pad && x < x1 - pad && z > z0 + pad && z < z1 - pad;
  const infield = m.infield;

  // buildings: town patches (or the whole block on street circuits), aligned to the nearest straight
  let tries = 0;
  while (buildings.matrices.length < maxBuild && tries++ < maxBuild * 30) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    const town = valueNoise(x / 40, z / 40, opts.seed + 11);
    if (!opts.urban && (town < 0.72 || infield(x, z))) continue;
    const w = (10 + R() * 26) * P, dpt = (10 + R() * 22) * P;
    const hgt = (opts.urban ? 8 + R() * R() * R() * 70 : 5 + R() * 12) * P;
    if (!inside(x, z, Math.max(w, dpt))) continue;
    if (clearance(x, z) < Math.max(w, dpt) * 0.75 + 2 * m.M) continue;
    const { i } = m.nearest(x, z);
    o.position.set(x, terrain.heightAt(x, z) - 0.2, z);
    o.rotation.set(0, Math.atan2(m.tx[i], m.tz[i]) + (R() < 0.15 ? Math.PI / 4 : 0), 0);
    o.scale.set(w, hgt, dpt);
    o.updateMatrix();
    buildings.matrices.push(o.matrix.clone());
    const shade = 0.62 + R() * 0.3;
    const tint = R();
    const c = new THREE.Color().copy(PALETTE.building).multiplyScalar(shade);
    if (tint < 0.18) c.lerp(new THREE.Color('#c9b7a0'), 0.35); // warm render
    else if (tint < 0.3) c.lerp(new THREE.Color('#8fa0b8'), 0.3); // glass / steel
    buildings.colors.push(c);
  }

  // trees: woods where the noise says so, plus loose rows along the circuit
  tries = 0;
  while (trees.matrices.length < maxTrees && tries++ < maxTrees * 25) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    const wood = valueNoise(x / 26, z / 26, opts.seed + 7);
    const town = valueNoise(x / 40, z / 40, opts.seed + 11);
    const p = wood < 0.32 ? 0.9 : wood < 0.45 ? 0.25 : 0.04;
    if (R() > p * (opts.urban ? 0.35 : 1) || town > 0.72) continue;
    if (!inside(x, z, 1)) continue;
    if (clearance(x, z) < 2.5 * m.M + 1.5 * P * 6) continue;
    const s = (0.7 + R() * 0.7) * P;
    o.position.set(x, terrain.heightAt(x, z) - 0.05, z);
    o.rotation.set(0, R() * Math.PI * 2, 0);
    o.scale.set(s * 6, s * (11 + R() * 6), s * 6);
    o.updateMatrix();
    trees.matrices.push(o.matrix.clone());
    trees.colors.push(new THREE.Color().setHSL(0.27 + R() * 0.08, 0.35 + R() * 0.2, 0.22 + R() * 0.12));
  }
  return { trees, buildings };
}

/** Low-poly tree (unit size: ~1 wide, 1 tall), vertex-coloured trunk + crown. */
export function treeGeometry(): THREE.BufferGeometry {
  const crown = new THREE.ConeGeometry(0.5, 0.78, 7, 1).translate(0, 0.61, 0).toNonIndexed();
  const trunk = new THREE.CylinderGeometry(0.06, 0.08, 0.26, 5, 1, true).translate(0, 0.13, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
  };
  paint(crown, new THREE.Color('#ffffff'));
  paint(trunk, new THREE.Color('#6b4a33').multiplyScalar(2.2));
  const out = mergeTwo(crown, trunk);
  out.computeVertexNormals();
  crown.dispose();
  trunk.dispose();
  return out;
}

/** Unit box with its base at y = 0, lighter roof. */
export function buildingGeometry(): THREE.BufferGeometry {
  const g = new Mesher();
  g.box([0, 0.5, 0], 0, 1, [0.5, 0.5, 0.5], new THREE.Color('#ffffff'), new THREE.Color('#ffffff').multiplyScalar(1.12));
  // a darker band of windows near the top reads as "building" from afar
  return g.geometry();
}

/** Small tileable asphalt grain (canvas), shared by both qualities. */
export function asphaltTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const R = rng(1234);
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 200 + R() * 55;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // faint racing-line rubber down the middle
  const grd = ctx.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0.3, 'rgba(0,0,0,0)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  grd.addColorStop(0.7, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
