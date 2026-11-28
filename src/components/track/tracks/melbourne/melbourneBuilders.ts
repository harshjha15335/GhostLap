import * as THREE from 'three';
import { Mesher, type V3 } from '../../mesher';
import { rng, smoothstep, valueNoise, wrapIndex, type TrackModel } from '../../trackModel';
import { at, PALETTE, type Layout, type Terrain } from '../../geometry';
import type { AlbertParkEnvData, Point2D } from './types';
import { buildWaterGeometry, createDaytimeWaterMaterial, smoothClosedPoly } from '../shared/water';
import { accumulateOsmBuildings, finalizeBuildings, pushAoWall } from '../shared/buildings';
import { buildTrackAdsGeometry } from '../shared/ads';

const C = (hex: string) => new THREE.Color(hex);

const MELB_PALETTE = {
  parkLawn: C('#5f9446'),
  parkLawnLight: C('#74a855'),
  ovalTurf: C('#4b9a43'),
  golfFairway: C('#69ad4d'),
  islandGrass: C('#4d833b'),
  parkRoad: C('#6d737c'),
  parkPath: C('#c7b99a'),
  lakeWater: C('#2385b8'),
  bayWater: C('#1a699c'),
  gumCanopyA: C('#4d7c45'),
  gumCanopyB: C('#628f52'),
  gumCanopyC: C('#3f6b3d'),
  gumTrunk: C('#bfb29b'),
  palmFrond: C('#4f8f3b'),
  palmTrunk: C('#8c7458'),
  pitFacade: C('#e9edf2'),
  pitGlass: C('#27435e'),
  pitGarage: C('#1d222b'),
  qatarBurgundy: C('#5c0632'),
  screenFrame: C('#1a1f28'),
  screenGlow: C('#29b6f6'),
  standSeatA: C('#24476e'),
  standSeatB: C('#2e5987'),
  standConcrete: C('#cdd4dc'),
  roofFlat: C('#aeb6bf'),
  roofParapet: C('#cfd6de'),
  roofHvac: C('#8d97a3'),
  roofTerracotta: C('#a85d46'),
  roofIron: C('#5c6670'),
  goldCrown: C('#d4af37'),
  stadiumBowl: C('#d8dfe7'),
  stadiumRoof: C('#f1f5f9'),
  msacArch: C('#e2e8f0'),
};

/** Point-in-polygon check (2D XZ) for lake/island tests. */
function pointInPoly(x: number, z: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function isInLake(x: number, z: number, env: AlbertParkEnvData): boolean {
  if (!env.lake.some((p) => pointInPoly(x, z, p))) return false;
  if (env.islands.some((p) => pointInPoly(x, z, p))) return false;
  return true;
}

/**
 * Bright, sunlit Melbourne Albert Park parkland diorama terrain.
 * Keeps the lake bed slightly recessed below water level so the lake plane never Z-fights,
 * and keeps the ground strictly beneath the asphalt ribbon.
 */
export function buildMelbourneTerrain(m: TrackModel, lay: Layout, env: AlbertParkEnvData, quality: 'high' | 'low'): Terrain {
  const { bounds: b, M } = m;
  const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const margin = ext * 0.22 + 18;
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
  const lakeBed = b.meanY - 0.65;

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
      if (d > far + 1.5 * M && isInLake(x, z, env)) {
        H[k] = lakeBed;
      } else {
        const gentle = (valueNoise(x / 35, z / 35, 2026) - 0.5) * 0.35;
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

    const n1 = valueNoise(x / 18, z / 18, 991);
    col.copy(MELB_PALETTE.parkLawn).lerp(MELB_PALETTE.parkLawnLight, smoothstep(0.3, 0.75, n1));
    if (dist[k] > 28 && !m.infield(x, z)) {
      const urbanBlend = smoothstep(28, 65, dist[k]) * 0.45;
      col.lerp(C('#9aa09a'), urbanBlend);
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

/** Triangulate 2D XZ polygons into a horizontal BufferGeometry with vertex colours. */
function polygonsToGeometry(polys: Point2D[][], y: number, color: THREE.Color, holes?: Point2D[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];

  for (let pIdx = 0; pIdx < polys.length; pIdx++) {
    const poly = polys[pIdx];
    if (poly.length < 3) continue;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    if (pIdx === 0 && holes) {
      for (const h of holes) {
        if (h.length < 3) continue;
        shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
      }
    }
    const sg = new THREE.ShapeGeometry(shape, 1);
    const nonIdx = sg.index ? sg.toNonIndexed() : sg;
    const pAttr = nonIdx.getAttribute('position');
    for (let i = 0; i < pAttr.count; i++) {
      const vx = pAttr.getX(i);
      const vz = -pAttr.getY(i);
      pos.push(vx, y, vz);
      nor.push(0, 1, 0);
      col.push(color.r, color.g, color.b);
      uvs.push(vx * 0.04, vz * 0.04);
    }
    sg.dispose();
    if (nonIdx !== sg) nonIdx.dispose();
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

export function buildMelbourneWater(m: TrackModel, env: AlbertParkEnvData, quality: 'high' | 'low' = 'high'): THREE.BufferGeometry {
  return buildWaterGeometry(env.lake, env.islands, env.bay, m.bounds.meanY - 0.16, quality, 9.5);
}

export function createMelbourneWaterMaterial(): THREE.ShaderMaterial {
  return createDaytimeWaterMaterial();
}

/**
 * Build merged parkland surface overlays:
 * lake islands, sports ovals, golf fairways, surrounding roads, and lakeside walking paths (1 draw call).
 */
export function buildParkOverlays(m: TrackModel, env: AlbertParkEnvData): THREE.BufferGeometry {
  const yBase = m.bounds.meanY - 0.105;
  const parts: THREE.BufferGeometry[] = [];

  if (env.islands.length > 0) {
    const smoothIsl = env.islands.map((p) => smoothClosedPoly(p, 1));
    parts.push(polygonsToGeometry(smoothIsl, yBase + 0.02, MELB_PALETTE.islandGrass));
  }
  // Clean sandy/stone shoreline embankment strip around the smoothed Albert Park Lake edge
  const shoreRim = new Mesher();
  for (const lakePoly of env.lake) {
    const sm = smoothClosedPoly(lakePoly, 2);
    for (let i = 0; i < sm.length; i++) {
      const [x0, z0] = sm[i];
      const [x1, z1] = sm[(i + 1) % sm.length];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = (-dz / len) * 0.42;
      const nz = (dx / len) * 0.42;
      shoreRim.quad(
        [x0 - nx, yBase - 0.03, z0 - nz],
        [x0 + nx, yBase - 0.03, z0 + nz],
        [x1 - nx, yBase - 0.03, z1 - nz],
        [x1 + nx, yBase - 0.03, z1 + nz],
        MELB_PALETTE.parkPath,
        true,
      );
    }
  }
  if (!shoreRim.empty) parts.push(shoreRim.geometry());
  if (env.ovals.length > 0) parts.push(polygonsToGeometry(env.ovals, yBase + 0.008, MELB_PALETTE.ovalTurf));
  if (env.golf.length > 0) parts.push(polygonsToGeometry(env.golf, yBase + 0.004, MELB_PALETTE.golfFairway));

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
      if (m.nearest(mx, mz).d < m.meanHalf * 1.45) continue;
      const nx = (-dz / len) * halfW;
      const nz = (dx / len) * halfW;
      ribbon.quad(
        [x0 - nx, y, z0 - nz],
        [x0 + nx, y, z0 + nz],
        [x1 - nx, y, z1 - nz],
        [x1 + nx, y, z1 + nz],
        color,
        true,
      );
    }
  };

  for (const r of env.roads) addPolyline(r.pts, (r.w > 0.8 ? 0.65 : 0.4) * m.M * 2.4, yBase + 0.015, MELB_PALETTE.parkRoad);
  for (const p of env.paths) addPolyline(p, 0.24 * m.M * 2.2, yBase + 0.018, MELB_PALETTE.parkPath);
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

/** Procedural tileable water normal/shimmer canvas texture (cheap, 128x128). */
export function waterShimmerTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wave =
        Math.sin((x / size) * Math.PI * 6 + Math.cos((y / size) * Math.PI * 4) * 1.4) * 0.5 +
        Math.cos((y / size) * Math.PI * 8 - (x / size) * Math.PI * 2) * 0.5;
      const v = Math.round(215 + wave * 32);
      const k = (y * size + x) * 4;
      img.data[k] = v;
      img.data[k + 1] = Math.min(255, v + 12);
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Australian eucalyptus/gum tree geometry (broad rounded canopy + pale gum trunk). */
export function gumTreeGeometry(): THREE.BufferGeometry {
  const crownA = new THREE.DodecahedronGeometry(0.46, 0).scale(1.15, 0.85, 1.05).translate(0, 0.68, 0);
  const crownB = new THREE.DodecahedronGeometry(0.32, 0).translate(0.24, 0.58, 0.14);
  const trunk = new THREE.CylinderGeometry(0.055, 0.085, 0.42, 5, 1, true).translate(0, 0.21, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const count = g.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
  };
  paint(crownA, C('#ffffff'));
  paint(crownB, C('#eef4ea'));
  paint(trunk, MELB_PALETTE.gumTrunk);
  const m1 = mergeNonIndexed(crownA, crownB);
  const out = mergeNonIndexed(m1, trunk);
  out.computeVertexNormals();
  crownA.dispose();
  crownB.dispose();
  trunk.dispose();
  m1.dispose();
  return out;
}

/** Lakeside palm tree geometry (tall slender trunk + radial frond crown). */
export function palmTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.04, 0.075, 0.82, 5, 1, true).translate(0, 0.41, 0).toNonIndexed();
  const crown = new THREE.ConeGeometry(0.42, 0.24, 6, 1).scale(1, -1, 1).translate(0, 0.84, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const count = g.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
  };
  paint(trunk, MELB_PALETTE.palmTrunk);
  paint(crown, C('#ffffff'));
  const out = mergeNonIndexed(trunk, crown);
  out.computeVertexNormals();
  trunk.dispose();
  crown.dispose();
  return out;
}

/** Build instanced matrices & colours for OSM parkland gum trees and lakeside palms. */
export function buildMelbourneInstances(m: TrackModel, terrain: Terrain, env: AlbertParkEnvData) {
  const R = rng(20260308);
  const P = m.upm * 1.35;
  const o = new THREE.Object3D();

  const gums = { matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] };
  const palms = { matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] };

  for (const [x, z, scale, kind] of env.trees) {
    const y = terrain.heightAt(x, z) - 0.04;
    o.position.set(x, y, z);
    o.rotation.set(0, R() * Math.PI * 2, 0);
    if (kind === 1) {
      o.scale.set(scale * P * 4.5, scale * P * 11.5, scale * P * 4.5);
      o.updateMatrix();
      palms.matrices.push(o.matrix.clone());
      palms.colors.push(MELB_PALETTE.palmFrond.clone().offsetHSL((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.06));
    } else {
      o.scale.set(scale * P * 6.5, scale * P * (9.5 + R() * 4.5), scale * P * 6.5);
      o.updateMatrix();
      gums.matrices.push(o.matrix.clone());
      const baseCol = R() < 0.35 ? MELB_PALETTE.gumCanopyA : R() < 0.7 ? MELB_PALETTE.gumCanopyB : MELB_PALETTE.gumCanopyC;
      gums.colors.push(baseCol.clone().offsetHSL((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.05));
    }
  }

  return { gums, palms };
}

export function buildMelbourneBuildings(
  m: TrackModel,
  terrain: Terrain,
  env: AlbertParkEnvData,
  quality: 'high' | 'low',
): { facades: THREE.BufferGeometry; roofs: THREE.BufferGeometry } {
  const acc = accumulateOsmBuildings(m, terrain, env, quality, 20260308);
  const { fPos, fNor, fCol, fUv, roofs } = acc;

  // --- Custom Low-Poly Melbourne Landmarks ---
  const baseGround = m.bounds.meanY - 0.12;

  // 1) Lakeside Stadium (real OSM oval position inside T3-T5: approx [-53.5, -71.5])
  {
    const sx = -53.5;
    const sz = -71.5;
    const sy = terrain.heightAt(sx, sz) - 0.06;
    const rx = 6.8;
    const rz = 9.4;
    const segs = quality === 'high' ? 20 : 12;
    const yaw = -0.58;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const bowlPt = (ang: number, radScale: number, y: number): V3 => {
      const lx = Math.cos(ang) * rx * radScale;
      const lz = Math.sin(ang) * rz * radScale;
      return [sx + lx * cs - lz * sn, sy + y, sz + lx * sn + lz * cs];
    };
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2;
      const a1 = ((k + 1) / segs) * Math.PI * 2;
      const isMainStand = k >= Math.floor(segs * 0.35) && k <= Math.floor(segs * 0.72);
      const hOuter = isMainStand ? 2.4 : 1.15;
      // Sloped stadium bowl
      roofs.quad(bowlPt(a0, 0.72, 0.15), bowlPt(a1, 0.72, 0.15), bowlPt(a0, 1.0, hOuter), bowlPt(a1, 1.0, hOuter), MELB_PALETTE.standSeatB);
      // Outer shell wall
      roofs.quad(bowlPt(a0, 1.0, 0), bowlPt(a1, 1.0, 0), bowlPt(a0, 1.0, hOuter), bowlPt(a1, 1.0, hOuter), MELB_PALETTE.stadiumBowl);
      // Swooping cantilevered roof canopy over main grandstand
      if (isMainStand) {
        roofs.quad(
          bowlPt(a0, 0.68, hOuter + 0.85),
          bowlPt(a1, 0.68, hOuter + 0.85),
          bowlPt(a0, 1.08, hOuter + 0.45),
          bowlPt(a1, 1.08, hOuter + 0.45),
          MELB_PALETTE.stadiumRoof,
        );
      }
    }
  }

  // 2) MSAC (Melbourne Sports & Aquatic Centre) NW of T5: iconic multi-bay vaulted roof
  {
    const mx = -62.5;
    const mz = -97.5;
    const my = terrain.heightAt(mx, mz) - 0.08;
    const yaw = -0.68;
    const fx = Math.cos(yaw);
    const fz = Math.sin(yaw);
    // Main aquatic hall base
    roofs.box([mx, my + 0.95, mz], fx, fz, [6.5, 0.95, 9.5], MELB_PALETTE.stadiumBowl, MELB_PALETTE.msacArch);
    // 3 vaulted barrel roof bays
    for (const off of [-5.8, 0, 5.8]) {
      const bx = mx + fx * off;
      const bz = mz + fz * off;
      roofs.box([bx, my + 2.15, bz], fx, fz, [6.2, 0.38, 2.3], MELB_PALETTE.msacArch, MELB_PALETTE.stadiumRoof);
      roofs.box([bx, my + 2.55, bz], fx, fz, [4.6, 0.22, 2.1], MELB_PALETTE.stadiumRoof);
    }
  }

  // 3) Recognisable Melbourne CBD Skyline Silhouettes to the north (-Z)
  const skylineHeroes: { x: number; z: number; w: number; d: number; h: number; goldBand: boolean; spire: number }[] = [
    // Eureka Tower silhouette (Southbank, north of Albert Park)
    { x: -16, z: -255, w: 6.2, d: 6.2, h: 35.5, goldBand: true, spire: 5.5 },
    // Australia 108 silhouette (tallest Melbourne tower with gold starburst band)
    { x: -4, z: -262, w: 6.8, d: 6.8, h: 39.0, goldBand: true, spire: 0 },
    // Rialto Towers stepped silhouette
    { x: -34, z: -278, w: 7.4, d: 5.4, h: 30.0, goldBand: false, spire: 2.5 },
    // 101 Collins / 120 Collins spire silhouettes
    { x: 18, z: -285, w: 6.0, d: 6.0, h: 29.0, goldBand: false, spire: 4.5 },
  ];

  const cbdTint = C('#c7dff5');
  for (const tw of skylineHeroes) {
    const hw = tw.w * 0.5;
    const hd = tw.d * 0.5;
    const vRep = tw.h / 3.1;
    const b0: V3 = [tw.x - hw, baseGround, tw.z - hd];
    const b1: V3 = [tw.x + hw, baseGround, tw.z - hd];
    const b2: V3 = [tw.x + hw, baseGround, tw.z + hd];
    const b3: V3 = [tw.x - hw, baseGround, tw.z + hd];
    const t0: V3 = [tw.x - hw, baseGround + tw.h, tw.z - hd];
    const t1: V3 = [tw.x + hw, baseGround + tw.h, tw.z - hd];
    const t2: V3 = [tw.x + hw, baseGround + tw.h, tw.z + hd];
    const t3: V3 = [tw.x - hw, baseGround + tw.h, tw.z + hd];
    pushAoWall(fPos, fNor, fCol, fUv, b0, b1, t0, t1, 0.004, 0.246, 0, vRep, cbdTint, 0.78, 1.0);
    pushAoWall(fPos, fNor, fCol, fUv, b1, b2, t1, t2, 0.004, 0.246, 0, vRep, cbdTint, 0.78, 1.0);
    pushAoWall(fPos, fNor, fCol, fUv, b2, b3, t2, t3, 0.004, 0.246, 0, vRep, cbdTint, 0.78, 1.0);
    pushAoWall(fPos, fNor, fCol, fUv, b3, b0, t3, t0, 0.004, 0.246, 0, vRep, cbdTint, 0.78, 1.0);
    roofs.quad(t0, t1, t3, t2, MELB_PALETTE.roofFlat, true);
    if (tw.goldBand) {
      roofs.box([tw.x, baseGround + tw.h * 0.84, tw.z], 0, 1, [hw * 1.06, 1.1, hd * 1.06], MELB_PALETTE.goldCrown);
    }
    if (tw.spire > 0) {
      roofs.box([tw.x, baseGround + tw.h + tw.spire * 0.5, tw.z], 0, 1, [0.35, tw.spire * 0.5, 0.35], MELB_PALETTE.roofParapet);
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
 * Build Melbourne-specific trackside structures (1 merged BufferGeometry draw call):
 * - Pit building (11 recessed team garage bays, Paddock Club glazed deck, cantilevered roof, Race Control tower)
 * - Pit wall + perches + Qatar Airways Start/Finish gantry + 5 FIA start light positions
 * - Real 2026 Albert Park grandstands (clean architectural tiered seating, roof canopies & columns, NO crowd)
 * - 3 pedestrian footbridges & giant trackside LED screens
 */
export function buildMelbourneStructures(
  m: TrackModel,
  lay: Layout,
  env: AlbertParkEnvData,
  quality: 'high' | 'low',
): { geometry: THREE.BufferGeometry; lights: V3[] } {
  const { n, M } = m;
  const g = new Mesher();
  const pitN = lay.pitN;
  const w = m.pit.width;

  // 1. Pit wall with steel catch rail
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

  // 2. Albert Park Pit & Paddock Building (multi-level, 11 team garages, Paddock Club glazing, cantilevered canopy)
  const core = Math.round(pitN * 0.64);
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
      [0, 4.2 * M],
      [0, 5.1 * M],
      [-1.5 * M, 5.3 * M],
      [-1.5 * M, 8.3 * M],
      [-2.1 * M, 8.6 * M],
      [-2.1 * M, 9.9 * M],
      [15.0 * M, 9.9 * M],
      [15.0 * M, -0.4],
    ],
    (k, i) => {
      if (k === 0) return Math.floor(i / bayLen) % 2 === 0 ? MELB_PALETTE.pitGarage : MELB_PALETTE.pitFacade;
      if (k === 1) return MELB_PALETTE.qatarBurgundy;
      if (k === 3) return MELB_PALETTE.pitGlass;
      if (k === 5) return MELB_PALETTE.pitFacade;
      if (k === 6) return PALETTE.roof;
      return MELB_PALETTE.pitFacade;
    },
  );

  // Rooftop Paddock Club terrace pavilions along pit building
  if (quality === 'high') {
    for (const frac of [-0.55, 0.35]) {
      const idx = wrapIndex(Math.round(frac * core), n);
      const p = at(m, idx, pitBase(idx) + 6.5 * M, 10.9 * M);
      g.box(p, m.tx[idx], m.tz[idx], [4.5 * M, 1.0 * M, 8.0 * M], MELB_PALETTE.pitFacade, PALETTE.roof);
    }
  }

  // Race Control & Podium Tower beside start/finish (cantilevered glazed control room)
  const rcPos = at(m, 0, pitBase(0) + 2.8 * M, 11.8 * M);
  g.box(rcPos, m.tx[0], m.tz[0], [3.2 * M, 2.8 * M, 5.4 * M], MELB_PALETTE.pitFacade, PALETTE.roof);
  g.box([rcPos[0] - m.rx[0] * 0.9 * M, rcPos[1] + 0.5 * M, rcPos[2] - m.rz[0] * 0.9 * M], m.tx[0], m.tz[0], [3.6 * M, 1.2 * M, 5.2 * M], MELB_PALETTE.pitGlass);

  // Pit lane outer walls
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

  // 3. Real 2026 Albert Park Grandstands — clean architectural seating (NO crowd)
  const standsToBuild = quality === 'high' ? env.grandstands : env.grandstands.slice(0, 6);
  for (const st of standsToBuild) {
    const i0 = sampleIdx(m, st.u0);
    const i1 = sampleIdx(m, st.u1);
    const S = st.side > 0 ? lay.R : lay.L;
    const rows = quality === 'high' ? st.rows : Math.max(3, Math.floor(st.rows / 2));
    const seats = (st.roofed ? 14.5 : 11.5) * M;
    const height = (st.roofed ? 9.2 : 7.0) * M;
    const prof: [number, number][] = [
      [0, -0.4],
      [0, 1.3 * M],
    ];
    for (let r = 0; r < rows; r++) {
      const x = ((r + 1) / rows) * seats;
      const y = 1.3 * M + ((r + 1) / rows) * height;
      prof.push([x - seats / rows, y], [x, y]);
    }
    prof.push([seats, -0.4]);

    extrudeAlong(g, m, i0, i1, st.side, (i) => S.barrier[i] + 1.4 * M, prof, (k) => {
      if (k <= 0 || k === prof.length - 2) return MELB_PALETTE.standConcrete;
      if (k % 2 === 1) return MELB_PALETTE.standConcrete;
      return (k >> 1) % 2 === 0 ? MELB_PALETTE.standSeatA : MELB_PALETTE.standSeatB;
    });

    if (st.roofed) {
      extrudeAlong(
        g,
        m,
        i0,
        i1,
        st.side,
        (i) => S.barrier[i] + 1.4 * M,
        [
          [1.4 * M, height + 3.6 * M],
          [seats + 0.8 * M, height + 2.6 * M],
        ],
        () => MELB_PALETTE.stadiumRoof,
        false,
      );
      // Rear structural roof columns
      const colStep = Math.max(3, Math.round((22 * m.upm) / m.ds));
      let kCount = 0;
      for (let i = i0; ; i = (i + 1) % n) {
        if (kCount % colStep === 0) {
          const p = at(m, i, st.side * (S.barrier[i] + 1.4 * M + seats * 0.96), 0);
          g.box([p[0], p[1] + (height + 2.6 * M) * 0.5, p[2]], m.tx[i], m.tz[i], [0.22 * M, (height + 2.6 * M) * 0.5, 0.22 * M], PALETTE.standFrame);
        }
        if (i === i1 || ++kCount > n) break;
      }
    }
  }

  // 4. Giant trackside LED screens (opposite Fangio, T1/Jones, T3/Hill, T9-10/Waite)
  if (quality === 'high') {
    for (const [u, side] of [
      [0.015, 1],
      [0.092, 1],
      [0.228, 1],
      [0.602, 1],
    ] as const) {
      const i = sampleIdx(m, u);
      const S = side > 0 ? lay.R : lay.L;
      const p = at(m, i, side * (S.barrier[i] + 3.5 * M), 0);
      g.box([p[0], p[1] + 2.8 * M, p[2]], m.tx[i], m.tz[i], [0.25 * M, 2.8 * M, 0.25 * M], PALETTE.steel);
      g.box([p[0], p[1] + 6.2 * M, p[2]], m.tx[i], m.tz[i], [0.32 * M, 2.2 * M, 4.2 * M], MELB_PALETTE.screenFrame);
      g.box(
        [p[0] - m.rx[i] * side * 0.35 * M, p[1] + 6.2 * M, p[2] - m.rz[i] * side * 0.35 * M],
        m.tx[i],
        m.tz[i],
        [0.06 * M, 1.9 * M, 3.8 * M],
        MELB_PALETTE.screenGlow,
      );
    }
  }

  // 5. Overhead pedestrian footbridges
  for (const br of env.bridges) {
    const i = sampleIdx(m, br.u);
    const left = lay.L.barrier[i] + 0.8 * M;
    const right = lay.R.barrier[i] + 0.8 * M;
    const h = 6.8 * M;
    for (const off of [-left, right]) {
      const p = at(m, i, off);
      g.box([p[0], p[1] + h / 2, p[2]], m.tx[i], m.tz[i], [0.45 * M, h / 2, 0.9 * M], PALETTE.steel);
    }
    const mid = at(m, i, (right - left) / 2, h);
    g.box(mid, m.tx[i], m.tz[i], [(left + right) / 2 + 0.6 * M, 1.15 * M, 1.2 * M], PALETTE.roof, PALETTE.building);
  }

  // 6. FIA Start/Finish Gantry (Qatar Airways 2026 burgundy trim + 5 red start lights)
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
  g.box(mid, fx, fz, [span / 2 + 0.2 * M, 0.95 * M, 0.34 * M], MELB_PALETTE.qatarBurgundy, PALETTE.steel);
  for (let k = 0; k < 5; k++) {
    const off = (k - 2) * 1.1 * M + (right - left) / 2;
    const p = at(m, 0, off, ph - 1.55 * M);
    lights.push([p[0] - fx * 0.36 * M, p[1], p[2] - fz * 0.36 * M]);
  }

  // 7. Albert Park Lake boatsheds & wooden jetties (Albert Park Yacht Club / Aquatic Club / Boatshed)
  const dockWood = C('#9c7a54');
  const shedWall = C('#e6e2d8');
  const shedRoof = C('#4d6073');
  const lakeY = m.bounds.meanY - 0.14;
  const jetties: { x: number; z: number; yaw: number; hasShed: boolean }[] = [
    { x: -32.0, z: -69.5, yaw: 0.35, hasShed: true },   // Aquatic Drive / Northern boatshed
    { x: 4.5, z: -56.0, yaw: -1.75, hasShed: true },    // East shore rowing / yacht club
    { x: -12.0, z: -12.5, yaw: 0.95, hasShed: true },   // Albert Park Yachting & Angling Club
    { x: 31.5, z: 32.0, yaw: -2.15, hasShed: false },   // Lakeside Drive southern jetty
  ];
  for (const jt of jetties) {
    const fx = Math.cos(jt.yaw);
    const fz = Math.sin(jt.yaw);
    // Timber jetty extending into the lake
    g.box([jt.x + fx * 1.4, lakeY + 0.08, jt.z + fz * 1.4], fx, fz, [0.45, 0.08, 2.2], dockWood);
    if (jt.hasShed) {
      g.box([jt.x - fx * 1.3, lakeY + 0.55, jt.z - fz * 1.3], fx, fz, [1.8, 0.55, 1.4], shedWall, shedRoof);
    }
  }

  return { geometry: g.geometry(), lights };
}

export function buildMelbourneAdsGeometry(m: TrackModel, lay: Layout, env: AlbertParkEnvData): THREE.BufferGeometry {
  return buildTrackAdsGeometry(m, lay, env, {
    titleBrand: 'qatar_airways',
    gantryHeightM: 7.8,
    bridgeHeightM: 6.8,
    pitFasciaOffsetM: -2.16,
    pitFasciaY0M: 8.65,
    pitFasciaY1M: 9.85,
  });
}
