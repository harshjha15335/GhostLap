import * as THREE from 'three';
import { Mesher, type V3 } from '../../mesher';
import { rng, smoothstep, valueNoise, wrapIndex, type TrackModel } from '../../trackModel';
import { at, PALETTE, type Layout, type Terrain } from '../../geometry';
import type { CircuitEnvData, Point2D } from '../shared/types';
import { buildWaterGeometry, createDaytimeWaterMaterial, smoothClosedPoly } from '../shared/water';
import { accumulateOsmBuildings, finalizeBuildings } from '../shared/buildings';
import { buildTrackAdsGeometry } from '../shared/ads';

const C = (hex: string) => new THREE.Color(hex);

const SH_PALETTE = {
  grass: C('#5f8c46'),
  grassLight: C('#73a054'),
  farmland: C('#6b9448'),
  plaza: C('#9097a0'),
  road: C('#666d76'),
  path: C('#c8beaa'),
  islandGrass: C('#4f803c'),
  pitFacade: C('#eceff3'),
  pitGlass: C('#23415c'),
  pitGarage: C('#1a1f28'),
  heinekenGreen: C('#006a34'),
  wingWhite: C('#f1f5f9'),
  wingUnderside: C('#cbd5e1'),
  wingRedAccent: C('#d91e2a'),
  standSeatA: C('#26466d'),
  standSeatB: C('#335b8a'),
  standConcrete: C('#cdd4dc'),
  canopyWhite: C('#f4f7fa'),
  pavilionWall: C('#ebe7df'),
  pavilionRoof: C('#3a434d'),
  pavilionBridge: C('#9e7c56'),
  screenFrame: C('#1a1f28'),
  screenGlow: C('#29b6f6'),
  treeCanopyA: C('#467a3e'),
  treeCanopyB: C('#5c8f4b'),
  treeTrunk: C('#7d634a'),
};

function pointInPoly(x: number, z: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function isInWater(x: number, z: number, env: CircuitEnvData): boolean {
  if (!env.lake.some((p) => pointInPoly(x, z, p))) return false;
  if (env.islands.some((p) => pointInPoly(x, z, p))) return false;
  return true;
}

function mergeNonIndexed(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
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

function polygonsToGeometry(polys: Point2D[][], y: number, color: THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const sg = new THREE.ShapeGeometry(shape, 1);
    const nonIdx = sg.index ? sg.toNonIndexed() : sg;
    const pAttr = nonIdx.getAttribute('position');
    for (let i = 0; i < pAttr.count; i++) {
      pos.push(pAttr.getX(i), y, -pAttr.getY(i));
      nor.push(0, 1, 0);
      col.push(color.r, color.g, color.b);
    }
    sg.dispose();
    if (nonIdx !== sg) nonIdx.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Jiading District (NW Shanghai) diorama terrain following Shanghai International Circuit's
 * elevation profile, with recessed basins under the paddock lake, ponds, and Jiading canals.
 */
export function buildShanghaiTerrain(m: TrackModel, lay: Layout, env: CircuitEnvData, quality: 'high' | 'low'): Terrain {
  const { bounds: b, M } = m;
  const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const margin = ext * 0.22 + 20;
  const x0 = b.minX - margin;
  const x1 = b.maxX + margin;
  const z0 = b.minZ - margin;
  const z1 = b.maxZ + margin;
  const res = quality === 'high' ? 180 : 100;
  const cell = Math.max(x1 - x0, z1 - z0) / res;
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const N = nx * nz;

  const H = new Float32Array(N);
  const dist = new Float32Array(N);
  const drop = 0.14;
  const waterBed = b.minY - 0.65;

  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const { i, d } = m.nearest(x, z);
      dist[k] = d;
      const lat = (x - m.px[i]) * m.rx[i] + (z - m.pz[i]) * m.rz[i];
      const far = lat > 0 ? lay.R.far[i] : lay.L.far[i];
      const baseH = m.py[i] - drop;
      if (d > far + 1.5 * M && isInWater(x, z, env)) {
        H[k] = waterBed;
      } else {
        const gentle = (valueNoise(x / 38, z / 38, 20260315) - 0.5) * 0.45;
        const t = smoothstep(far, far + 14 * M, d);
        H[k] = baseH * (1 - t) + (b.meanY - drop + gentle) * t;
      }
    }
  }

  let minH = Infinity;
  for (let k = 0; k < N; k++) minH = Math.min(minH, H[k]);
  const bottom = minH - Math.max(3.5, ext * 0.03);

  const pos: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const col = new THREE.Color();

  for (let k = 0; k < N; k++) {
    const gx = k % nx;
    const gz = Math.floor(k / nx);
    const x = x0 + gx * cell;
    const z = z0 + gz * cell;
    pos.push(x, H[k], z);
    const n1 = valueNoise(x / 20, z / 20, 773);
    col.copy(SH_PALETTE.grass).lerp(SH_PALETTE.grassLight, smoothstep(0.3, 0.75, n1));
    if (dist[k] > 32 && !m.infield(x, z)) {
      col.lerp(C('#9aa09a'), smoothstep(32, 75, dist[k]) * 0.42);
    }
    cols.push(col.r, col.g, col.b);
  }

  for (let gz = 0; gz < nz - 1; gz++) {
    for (let gx = 0; gx < nx - 1; gx++) {
      const a = gz * nx + gx;
      const bb = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, c, bb, bb, c, d);
    }
  }

  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  top.setIndex(idx);
  top.computeVertexNormals();

  const skirt = new Mesher();
  const side = (k0: number, k1: number) => {
    const xA = x0 + (k0 % nx) * cell;
    const zA = z0 + Math.floor(k0 / nx) * cell;
    const xB = x0 + (k1 % nx) * cell;
    const zB = z0 + Math.floor(k1 / nx) * cell;
    skirt.quad([xA, bottom, zA], [xB, bottom, zB], [xA, H[k0], zA], [xB, H[k1], zB], PALETTE.plinth);
  };
  for (let gx = 0; gx < nx - 1; gx++) {
    side(gx, gx + 1);
    side((nz - 1) * nx + gx + 1, (nz - 1) * nx + gx);
  }
  for (let gz = 0; gz < nz - 1; gz++) {
    side((gz + 1) * nx, gz * nx);
    side(gz * nx + nx - 1, (gz + 1) * nx + nx - 1);
  }

  const sidesGeo = skirt.geometry();
  const merged = mergeNonIndexed(top.toNonIndexed(), sidesGeo);
  top.dispose();
  sidesGeo.dispose();

  const sample = (arr: Float32Array, x: number, z: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cell));
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const u = fx - gx;
    const v = fz - gz;
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

export function buildShanghaiWater(m: TrackModel, env: CircuitEnvData, quality: 'high' | 'low'): THREE.BufferGeometry {
  return buildWaterGeometry(env.lake, env.islands, [], m.bounds.minY - 0.16, quality, 6.5);
}

export function createShanghaiWaterMaterial(): THREE.ShaderMaterial {
  return createDaytimeWaterMaterial({
    shallowColor: '#3ea8bf',
    deepColor: '#165d87',
    skyColor: '#d2ebff',
  });
}

/** Merged car parks/plazas, green/farmland patches, shoreline embankments, roads & paths (1 draw call). */
export function buildShanghaiOverlays(m: TrackModel, env: CircuitEnvData): THREE.BufferGeometry {
  const yBase = m.bounds.minY - 0.105;
  const parts: THREE.BufferGeometry[] = [];

  if (env.islands.length > 0) parts.push(polygonsToGeometry(env.islands.map((p) => smoothClosedPoly(p, 1)), yBase + 0.02, SH_PALETTE.islandGrass));
  if (env.ovals.length > 0) parts.push(polygonsToGeometry(env.ovals, yBase + 0.008, SH_PALETTE.plaza));
  if (env.golf.length > 0) parts.push(polygonsToGeometry(env.golf, yBase + 0.004, SH_PALETTE.farmland));

  // Shoreline embankment trim around smoothed paddock lake & ponds
  const shoreRim = new Mesher();
  for (const waterPoly of env.lake.slice(0, 12)) {
    const sm = smoothClosedPoly(waterPoly, 1);
    for (let i = 0; i < sm.length; i++) {
      const [x0, z0] = sm[i];
      const [x1, z1] = sm[(i + 1) % sm.length];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = (-dz / len) * 0.36;
      const nz = (dx / len) * 0.36;
      shoreRim.quad(
        [x0 - nx, yBase - 0.03, z0 - nz],
        [x0 + nx, yBase - 0.03, z0 + nz],
        [x1 - nx, yBase - 0.03, z1 - nz],
        [x1 + nx, yBase - 0.03, z1 + nz],
        SH_PALETTE.path,
        true,
      );
    }
  }
  if (!shoreRim.empty) parts.push(shoreRim.geometry());

  const ribbon = new Mesher();
  const addPolyline = (pts: Point2D[], halfW: number, y: number, color: THREE.Color) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      if (m.nearest(mx, mz).d < m.meanHalf * 1.5) continue;
      const nx = (-dz / len) * halfW;
      const nz = (dx / len) * halfW;
      ribbon.quad([x0 - nx, y, z0 - nz], [x0 + nx, y, z0 + nz], [x1 - nx, y, z1 - nz], [x1 + nx, y, z1 + nz], color, true);
    }
  };

  for (const r of env.roads) addPolyline(r.pts, (r.w > 0.8 ? 0.72 : 0.42) * m.M * 2.2, yBase + 0.015, SH_PALETTE.road);
  for (const p of env.paths) addPolyline(p, 0.25 * m.M * 2.0, yBase + 0.018, SH_PALETTE.path);
  if (!ribbon.empty) parts.push(ribbon.geometry());

  if (parts.length === 0) return new THREE.BufferGeometry();
  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const next = mergeNonIndexed(acc, parts[i]);
    acc.dispose();
    parts[i].dispose();
    acc = next;
  }
  return acc;
}

/** Deciduous parkland tree geometry for Jiading / Shanghai campus. */
export function shanghaiTreeGeometry(): THREE.BufferGeometry {
  const crown = new THREE.DodecahedronGeometry(0.48, 0).scale(1.05, 0.9, 1.05).translate(0, 0.66, 0);
  const trunk = new THREE.CylinderGeometry(0.055, 0.085, 0.38, 5, 1, true).translate(0, 0.19, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const count = g.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
  };
  paint(crown, C('#ffffff'));
  paint(trunk, SH_PALETTE.treeTrunk);
  const out = mergeNonIndexed(crown, trunk);
  out.computeVertexNormals();
  crown.dispose();
  trunk.dispose();
  return out;
}

export function buildShanghaiTreeInstances(m: TrackModel, terrain: Terrain, env: CircuitEnvData) {
  const R = rng(20260315);
  const P = m.upm * 1.15;
  const o = new THREE.Object3D();
  const trees = { matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] };
  for (const [x, z, scale] of env.trees) {
    const y = terrain.heightAt(x, z) - 0.04;
    o.position.set(x, y, z);
    o.rotation.set(0, R() * Math.PI * 2, 0);
    o.scale.set(scale * P * 6.0, scale * P * (8.5 + R() * 4.0), scale * P * 6.0);
    o.updateMatrix();
    trees.matrices.push(o.matrix.clone());
    const baseCol = R() < 0.5 ? SH_PALETTE.treeCanopyA : SH_PALETTE.treeCanopyB;
    trees.colors.push(baseCol.clone().offsetHSL((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.05));
  }
  return trees;
}

/** Build OSM Jiading buildings + Yuyuan-Garden-inspired Paddock Team Pavilions behind the pits (2 draw calls). */
export function buildShanghaiBuildings(
  m: TrackModel,
  terrain: Terrain,
  env: CircuitEnvData,
  quality: 'high' | 'low',
): { facades: THREE.BufferGeometry; roofs: THREE.BufferGeometry } {
  const acc = accumulateOsmBuildings(m, terrain, env, quality, 20260315);
  const { roofs } = acc;
  const M = m.M;

  // Yuyuan-Garden-inspired Paddock Team Pavilions arranged behind the pit building (+right of pit straight)
  const fx = m.tx[0];
  const fz = m.tz[0];
  const pitBase0 = m.pit.centre + m.pit.width / 2 + 19.5 * M;
  const pavilionCount = quality === 'high' ? 11 : 6;
  for (let k = 0; k < pavilionCount; k++) {
    const row = k % 2;
    const col = Math.floor(k / 2);
    const along = (col - (pavilionCount / 4 - 0.5)) * 12.5 * M;
    const out = pitBase0 + row * 12.0 * M;
    const cx = m.px[0] + m.rx[0] * out + fx * along;
    const cz = m.pz[0] + m.rz[0] * out + fz * along;
    const cy = terrain.heightAt(cx, cz) - 0.06;
    // Lower pavilion hall + stepped traditional tiered roof
    roofs.box([cx, cy + 2.4 * M, cz], fx, fz, [3.8 * M, 2.4 * M, 4.4 * M], SH_PALETTE.pavilionWall, SH_PALETTE.pavilionRoof);
    roofs.box([cx, cy + 5.1 * M, cz], fx, fz, [4.5 * M, 0.45 * M, 5.1 * M], SH_PALETTE.pavilionRoof);
    roofs.box([cx, cy + 5.9 * M, cz], fx, fz, [2.8 * M, 0.45 * M, 3.3 * M], SH_PALETTE.pavilionRoof);
    // Timber walkway connecting rows over the paddock water garden
    if (row === 0) {
      roofs.box([cx + m.rx[0] * 6.0 * M, cy + 0.35 * M, cz + m.rz[0] * 6.0 * M], fx, fz, [2.6 * M, 0.25 * M, 1.1 * M], SH_PALETTE.pavilionBridge);
    }
  }

  return finalizeBuildings(acc);
}

function sampleIdx(m: TrackModel, u: number): number {
  const uu = ((u % 1) + 1) % 1;
  return Math.floor(uu * m.n) % m.n;
}

function extrudeAlong(
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
  let guard = 0;
  for (let i = i0; ; i = (i + 1) % n) {
    if (prev >= 0) {
      for (let k = 0; k < profile.length - 1; k++) {
        g.quad(pt(prev, profile[k]), pt(i, profile[k]), pt(prev, profile[k + 1]), pt(i, profile[k + 1]), colour(k, i));
      }
    }
    prev = i;
    if (i === i1 || ++guard > n) break;
  }
  if (closeEnds) {
    for (const i of [i0, i1]) {
      for (let k = 1; k < profile.length - 1; k++) {
        g.quad(pt(i, profile[0]), pt(i, profile[k]), pt(i, profile[0]), pt(i, profile[k + 1]), colour(-1, i));
      }
    }
  }
}

/**
 * Build Shanghai International Circuit's signature architecture (1 merged BufferGeometry draw call):
 * - Massive 400m Main Grandstand A with sweeping cantilevered roof canopy & structural tension masts (NO crowd)
 * - Iconic Twin Elevated "Wing" Hospitality Bridges spanning high over the pit straight
 * - Pit Building (11 recessed garages, media/VIP deck) & Race Control Tower
 * - Crowd-free corner grandstands (H/J at T1-T2 snail, B at T6, K at T14 hairpin, L at T16)
 * - Heineken 2026 Start/Finish gantry + 5 FIA start lights + giant trackside screens
 */
export function buildShanghaiStructures(
  m: TrackModel,
  lay: Layout,
  env: CircuitEnvData,
  quality: 'high' | 'low',
): { geometry: THREE.BufferGeometry; lights: V3[] } {
  const { n, M } = m;
  const g = new Mesher();
  const pitN = lay.pitN;
  const w = m.pit.width;

  // 1. Pit wall
  const pwN = pitN - Math.ceil(Math.max(2, Math.round(pitN * 0.3)) * 0.55);
  extrudeAlong(
    g,
    m,
    wrapIndex(-pwN, n),
    pwN,
    1,
    (i) => lay.R.barrier[i],
    [
      [0, -0.3],
      [0, 1.15 * M],
      [0.34 * M, 1.15 * M],
      [0.34 * M, -0.3],
    ],
    (k) => (k === 1 ? PALETTE.steel : PALETTE.wall),
  );

  // 2. Pit Building & Media Centre (multi-level, 11 team garage bays, Heineken fascia trim)
  const core = Math.round(pitN * 0.66);
  const b0 = wrapIndex(-core, n);
  const pitBase = (i: number) => lay.pitCentre[i] + w / 2 + 0.5 * M;
  const bayLen = Math.max(1, Math.round((core * 2) / 22));
  extrudeAlong(
    g,
    m,
    b0,
    core,
    1,
    pitBase,
    [
      [0, -0.4],
      [0, 4.4 * M],
      [0, 5.2 * M],
      [-1.5 * M, 5.5 * M],
      [-1.5 * M, 8.8 * M],
      [-2.1 * M, 9.2 * M],
      [-2.1 * M, 10.6 * M],
      [15.5 * M, 10.6 * M],
      [15.5 * M, -0.4],
    ],
    (k, i) => {
      if (k === 0) return Math.floor(i / bayLen) % 2 === 0 ? SH_PALETTE.pitGarage : SH_PALETTE.pitFacade;
      if (k === 1) return SH_PALETTE.heinekenGreen;
      if (k === 3) return SH_PALETTE.pitGlass;
      if (k === 6) return PALETTE.roof;
      return SH_PALETTE.pitFacade;
    },
  );

  // Race Control & Media Tower beside start/finish
  const rcPos = at(m, 0, pitBase(0) + 3.2 * M, 13.0 * M);
  g.box(rcPos, m.tx[0], m.tz[0], [3.5 * M, 3.2 * M, 5.8 * M], SH_PALETTE.pitFacade, PALETTE.roof);
  g.box([rcPos[0] - m.rx[0] * 1.0 * M, rcPos[1] + 0.6 * M, rcPos[2] - m.rz[0] * 1.0 * M], m.tx[0], m.tz[0], [3.8 * M, 1.3 * M, 5.5 * M], SH_PALETTE.pitGlass);

  // Pit outer walls
  const laneOut = (i: number) => lay.pitCentre[i] + w / 2 + 0.3 * M;
  const wallProf: [number, number][] = [
    [0, -0.3],
    [0, 1.15 * M],
    [0.3 * M, 1.15 * M],
    [0.3 * M, -0.3],
  ];
  const wallCol = (k: number) => (k === 1 ? PALETTE.steel : PALETTE.wall);
  extrudeAlong(g, m, core, pitN, 1, laneOut, wallProf, wallCol);
  extrudeAlong(g, m, wrapIndex(-pitN, n), wrapIndex(-core, n), 1, laneOut, wallProf, wallCol);

  // 3. Signature Main Grandstand A (massive 400m stand on left -1 of pit straight + sweeping lotus/sail canopy + tension masts)
  const main0 = sampleIdx(m, 0.955);
  const main1 = sampleIdx(m, 0.048);
  const mainRows = quality === 'high' ? 9 : 5;
  const mainDepth = 20.5 * M;
  const mainH = 14.0 * M;
  const mainProf: [number, number][] = [
    [0, -0.4],
    [0, 1.8 * M],
  ];
  for (let r = 0; r < mainRows; r++) {
    const x = ((r + 1) / mainRows) * mainDepth;
    const y = 1.8 * M + ((r + 1) / mainRows) * mainH;
    mainProf.push([x - mainDepth / mainRows, y], [x, y]);
  }
  mainProf.push([mainDepth, -0.4]);

  extrudeAlong(g, m, main0, main1, -1, (i) => lay.L.barrier[i] + 1.6 * M, mainProf, (k) => {
    if (k <= 0 || k === mainProf.length - 2 || k % 2 === 1) return SH_PALETTE.standConcrete;
    return (k >> 1) % 2 === 0 ? SH_PALETTE.standSeatA : SH_PALETTE.standSeatB;
  });
  // Sweeping cantilevered white roof canopy
  extrudeAlong(
    g,
    m,
    main0,
    main1,
    -1,
    (i) => lay.L.barrier[i] + 1.6 * M,
    [
      [-1.5 * M, mainH + 5.6 * M],
      [mainDepth * 0.45, mainH + 6.4 * M],
      [mainDepth + 1.5 * M, mainH + 3.8 * M],
    ],
    () => SH_PALETTE.canopyWhite,
    false,
  );
  // Iconic structural tension masts along Main Grandstand A
  const mastStep = Math.max(4, Math.round((34 * m.upm) / m.ds));
  let mk = 0;
  for (let i = main0; ; i = (i + 1) % n) {
    if (mk % mastStep === 0) {
      const p = at(m, i, -(lay.L.barrier[i] + 1.6 * M + mainDepth * 0.96), 0);
      g.box([p[0], p[1] + (mainH + 9.5 * M) * 0.5, p[2]], m.tx[i], m.tz[i], [0.32 * M, (mainH + 9.5 * M) * 0.5, 0.32 * M], SH_PALETTE.wingWhite);
    }
    if (i === main1 || ++mk > n) break;
  }

  // 4. Signature Twin Elevated "Wing" Hospitality Bridges over the pit straight + Back Straight Bridge
  for (const br of env.bridges) {
    const i = sampleIdx(m, br.u);
    const isWing = br.name.toLowerCase().includes('wing');
    const left = lay.L.barrier[i] + (isWing ? 2.2 : 0.8) * M;
    const right = (isWing ? lay.pitCentre[i] + w / 2 + 2.5 * M : lay.R.barrier[i] + 0.8 * M);
    const h = (isWing ? 13.5 : 7.2) * M;
    const span = left + right;
    const mid = at(m, i, (right - left) / 2, h);

    // Twin supporting architectural piers
    for (const off of [-left, right]) {
      const p = at(m, i, off);
      g.box([p[0], p[1] + h / 2, p[2]], m.tx[i], m.tz[i], [0.7 * M, h / 2, (isWing ? 1.6 : 0.9) * M], SH_PALETTE.wingWhite);
    }

    if (isWing) {
      // Aerodynamic curved-wing hospitality deck + glazed viewing ribbon + red Shanghai accent trim
      g.box(mid, m.tx[i], m.tz[i], [span / 2 + 4.5 * M, 1.35 * M, 3.8 * M], SH_PALETTE.wingWhite, SH_PALETTE.canopyWhite);
      g.box([mid[0], mid[1] - 0.1 * M, mid[2]], m.tx[i], m.tz[i], [span / 2 + 2.5 * M, 0.72 * M, 4.0 * M], SH_PALETTE.pitGlass);
      g.box([mid[0], mid[1] + 1.42 * M, mid[2]], m.tx[i], m.tz[i], [span / 2 + 5.0 * M, 0.18 * M, 4.1 * M], SH_PALETTE.wingRedAccent);
    } else {
      g.box(mid, m.tx[i], m.tz[i], [span / 2 + 0.6 * M, 1.15 * M, 1.2 * M], PALETTE.roof, PALETTE.building);
    }
  }

  // 5. Corner Grandstands (H/J at T1-T2 snail, B at T6, K at T14 hairpin, L at T16) — crowd removed completely
  const standsToBuild = quality === 'high' ? env.grandstands : env.grandstands.slice(0, 4);
  for (const st of standsToBuild) {
    const i0 = sampleIdx(m, st.u0);
    const i1 = sampleIdx(m, st.u1);
    const S = st.side > 0 ? lay.R : lay.L;
    const rows = quality === 'high' ? st.rows : Math.max(3, Math.floor(st.rows / 2));
    const depth = 13.5 * M;
    const height = 8.4 * M;
    const prof: [number, number][] = [
      [0, -0.4],
      [0, 1.4 * M],
    ];
    for (let r = 0; r < rows; r++) {
      const x = ((r + 1) / rows) * depth;
      const y = 1.4 * M + ((r + 1) / rows) * height;
      prof.push([x - depth / rows, y], [x, y]);
    }
    prof.push([depth, -0.4]);

    extrudeAlong(g, m, i0, i1, st.side, (i) => S.barrier[i] + 1.5 * M, prof, (k) => {
      if (k <= 0 || k === prof.length - 2 || k % 2 === 1) return SH_PALETTE.standConcrete;
      return (k >> 1) % 2 === 0 ? SH_PALETTE.standSeatA : SH_PALETTE.standSeatB;
    });
  }

  // 6. Giant trackside LED screens (Main straight, T1-T2 snail, T6, T14 Hairpin)
  if (quality === 'high') {
    for (const [u, side] of [
      [0.015, 1],
      [0.115, 1],
      [0.365, 1],
      [0.842, 1],
    ] as const) {
      const i = sampleIdx(m, u);
      const S = side > 0 ? lay.R : lay.L;
      const p = at(m, i, side * (S.barrier[i] + 3.8 * M), 0);
      g.box([p[0], p[1] + 2.8 * M, p[2]], m.tx[i], m.tz[i], [0.25 * M, 2.8 * M, 0.25 * M], PALETTE.steel);
      g.box([p[0], p[1] + 6.4 * M, p[2]], m.tx[i], m.tz[i], [0.32 * M, 2.3 * M, 4.4 * M], SH_PALETTE.screenFrame);
      g.box(
        [p[0] - m.rx[i] * side * 0.36 * M, p[1] + 6.4 * M, p[2] - m.rz[i] * side * 0.36 * M],
        m.tx[i],
        m.tz[i],
        [0.06 * M, 2.0 * M, 4.0 * M],
        SH_PALETTE.screenGlow,
      );
    }
  }

  // 7. FIA Start/Finish Gantry (Heineken 2026 green trim + 5 red start lights)
  const lights: V3[] = [];
  const fx = m.tx[0];
  const fz = m.tz[0];
  const left = Math.min(lay.L.barrier[0], m.hwL[0] + 1.2 * M);
  const right = m.hwR[0] + 0.6 * M;
  const ph = 7.8 * M;
  for (const off of [-left, right]) {
    const p = at(m, 0, off);
    g.box([p[0], p[1] + ph / 2, p[2]], fx, fz, [0.38 * M, ph / 2, 0.38 * M], PALETTE.steel);
  }
  const span = left + right;
  const mid = at(m, 0, (right - left) / 2, ph);
  g.box(mid, fx, fz, [span / 2 + 0.2 * M, 0.95 * M, 0.34 * M], SH_PALETTE.heinekenGreen, PALETTE.steel);
  for (let k = 0; k < 5; k++) {
    const off = (k - 2) * 1.1 * M + (right - left) / 2;
    const p = at(m, 0, off, ph - 1.55 * M);
    lights.push([p[0] - fx * 0.36 * M, p[1], p[2] - fz * 0.36 * M]);
  }

  return { geometry: g.geometry(), lights };
}

export function buildShanghaiAdsGeometry(m: TrackModel, lay: Layout, env: CircuitEnvData): THREE.BufferGeometry {
  return buildTrackAdsGeometry(m, lay, env, {
    titleBrand: 'heineken',
    gantryHeightM: 7.8,
    bridgeHeightM: 7.2,
    pitFasciaOffsetM: -2.16,
    pitFasciaY0M: 9.25,
    pitFasciaY1M: 10.55,
    standBrands: ['heineken', 'pirelli', 'aramco', 'dhl', 'qatar_airways'],
  });
}
