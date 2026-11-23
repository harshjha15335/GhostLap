import * as THREE from 'three';
import { Mesher, type V3 } from '../../mesher';
import { rng, smoothstep, valueNoise, wrapIndex, type TrackModel } from '../../trackModel';
import { at, PALETTE, type Layout, type Terrain } from '../../geometry';
import type { AlbertParkEnvData, Point2D } from './types';

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

/** Chaikin corner-cutting smoothing for closed 2D polygons (eliminates jagged OSM lake edges). */
function smoothClosedPoly(poly: Point2D[], iterations = 2): Point2D[] {
  let pts = poly;
  for (let it = 0; it < iterations; it++) {
    const next: Point2D[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % n];
      next.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25]);
      next.push([x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
    }
    pts = next;
  }
  return pts;
}

/** Distance from point (px, pz) to closest edge of a list of closed polygons. */
function distToPolys(px: number, pz: number, polys: Point2D[][]): number {
  let bestSq = Infinity;
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % n];
      const dx = bx - ax;
      const dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 1e-8 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + dx * t - px;
      const ez = az + dz * t - pz;
      const dSq = ex * ex + ez * ez;
      if (dSq < bestSq) bestSq = dSq;
    }
  }
  return Math.sqrt(bestSq);
}

/**
 * Build Albert Park Lake + Port Phillip Bay water geometry with:
 * - Chaikin-smoothed shoreline & islands (zero jagged OSM kinks)
 * - Interior tessellation grid inside the lake so shore-distance depth tint interpolates smoothly
 * - Baked shore-distance stored in vertex color.r (0 = shore, 1 = deep middle), color.g = bay flag
 */
export function buildMelbourneWater(m: TrackModel, env: AlbertParkEnvData, quality: 'high' | 'low' = 'high'): THREE.BufferGeometry {
  const waterY = m.bounds.meanY - 0.16;
  const smoothLakes = env.lake.map((p) => smoothClosedPoly(p, quality === 'high' ? 2 : 1));
  const smoothIslands = env.islands.map((p) => smoothClosedPoly(p, 1));
  const allShores = [...smoothLakes, ...smoothIslands];

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];

  const pushTri = (a: [number, number], b: [number, number], c: [number, number], y: number, isBay: boolean) => {
    for (const [vx, vz] of [a, b, c]) {
      pos.push(vx, y, vz);
      nor.push(0, 1, 0);
      const dShore = isBay ? 1.0 : Math.min(1.0, distToPolys(vx, vz, allShores) / 9.5);
      col.push(dShore, isBay ? 1.0 : 0.0, 0.0);
      uvs.push(vx * 0.06, vz * 0.06);
    }
  };

  // Tessellate smoothed lake via ShapeGeometry and subdivide large triangles so interior depth gradient is smooth
  const maxEdge = quality === 'high' ? 6.5 : 11.0;
  const emitSubdivided = (a: [number, number], b: [number, number], c: [number, number], y: number, isBay: boolean, depth = 0) => {
    const dab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const dca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const longest = Math.max(dab, dbc, dca);
    if (depth >= 4 || longest <= maxEdge) {
      pushTri(a, b, c, y, isBay);
      return;
    }
    const mab: [number, number] = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    const mbc: [number, number] = [(b[0] + c[0]) * 0.5, (b[1] + c[1]) * 0.5];
    const mca: [number, number] = [(c[0] + a[0]) * 0.5, (c[1] + a[1]) * 0.5];
    emitSubdivided(a, mab, mca, y, isBay, depth + 1);
    emitSubdivided(mab, b, mbc, y, isBay, depth + 1);
    emitSubdivided(mca, mbc, c, y, isBay, depth + 1);
    emitSubdivided(mab, mbc, mca, y, isBay, depth + 1);
  };

  for (let pIdx = 0; pIdx < smoothLakes.length; pIdx++) {
    const poly = smoothLakes[pIdx];
    if (poly.length < 3) continue;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    if (pIdx === 0) {
      for (const h of smoothIslands) {
        if (h.length < 3) continue;
        shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
      }
    }
    const sg = new THREE.ShapeGeometry(shape, 1);
    const nonIdx = sg.index ? sg.toNonIndexed() : sg;
    const pAttr = nonIdx.getAttribute('position');
    for (let i = 0; i < pAttr.count; i += 3) {
      const a: [number, number] = [pAttr.getX(i), -pAttr.getY(i)];
      const b: [number, number] = [pAttr.getX(i + 1), -pAttr.getY(i + 1)];
      const c: [number, number] = [pAttr.getX(i + 2), -pAttr.getY(i + 2)];
      emitSubdivided(a, b, c, waterY, false);
    }
    sg.dispose();
    if (nonIdx !== sg) nonIdx.dispose();
  }

  // Port Phillip Bay coastal water hint to the south-west
  if (env.bay.length >= 3) {
    const shape = new THREE.Shape(env.bay.map(([x, z]) => new THREE.Vector2(x, -z)));
    const sg = new THREE.ShapeGeometry(shape, 1);
    const nonIdx = sg.index ? sg.toNonIndexed() : sg;
    const pAttr = nonIdx.getAttribute('position');
    for (let i = 0; i < pAttr.count; i += 3) {
      pushTri(
        [pAttr.getX(i), -pAttr.getY(i)],
        [pAttr.getX(i + 1), -pAttr.getY(i + 1)],
        [pAttr.getX(i + 2), -pAttr.getY(i + 2)],
        waterY - 0.05,
        true,
      );
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

/**
 * Custom lightweight GLSL water shader for Albert Park Lake & Port Phillip Bay:
 * - Two scrolling crossed procedural wave normal layers (no heavy planar reflection pass)
 * - Depth tint from baked vertex shore-distance (turquoise shallows -> deep Melbourne blue)
 * - View-dependent Fresnel sky reflection matching daytime SkyDome
 * - Crisp midday sun specular glints + subtle shoreline foam/edge highlight
 */
export function createMelbourneWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(140, 170, 90).normalize() },
      uSkyColor: { value: new THREE.Color('#d2ebff') },
      uShallowColor: { value: new THREE.Color('#42b2c9') },
      uDeepColor: { value: new THREE.Color('#145a8a') },
      uBayColor: { value: new THREE.Color('#134c78') },
      uFoamColor: { value: new THREE.Color('#e6f6fa') },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vWorldPos;
      varying float vShore;
      varying float vBay;
      void main() {
        vShore = color.r;
        vBay = color.g;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSkyColor;
      uniform vec3 uShallowColor;
      uniform vec3 uDeepColor;
      uniform vec3 uBayColor;
      uniform vec3 uFoamColor;
      varying vec3 vWorldPos;
      varying float vShore;
      varying float vBay;

      // Cheap dual-layer crossed wind-ripple normal perturbation
      vec3 waveNormal(vec2 p, float t) {
        float w1 = sin(p.x * 0.55 + p.y * 0.28 + t * 1.15) * 0.5 + cos(p.y * 0.72 - p.x * 0.35 + t * 0.92) * 0.5;
        float w2 = sin(p.x * 1.35 - p.y * 0.95 - t * 1.45) * 0.5 + cos(p.y * 1.55 + p.x * 0.85 + t * 1.10) * 0.5;
        float dx = (cos(p.x * 0.55 + p.y * 0.28 + t * 1.15) * 0.28 + cos(p.x * 1.35 - p.y * 0.95 - t * 1.45) * 0.16) * 0.085;
        float dz = (sin(p.y * 0.72 - p.x * 0.35 + t * 0.92) * -0.28 + sin(p.y * 1.55 + p.x * 0.85 + t * 1.10) * -0.16) * 0.085;
        return normalize(vec3(dx + (w1 - w2) * 0.015, 1.0, dz + (w1 + w2) * 0.015));
      }

      void main() {
        vec3 N = waveNormal(vWorldPos.xz, uTime);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        // Depth tint: lighter turquoise near shore -> richer blue in middle
        float depthT = smoothstep(0.0, 0.85, vShore);
        vec3 baseCol = mix(uShallowColor, uDeepColor, depthT);
        baseCol = mix(baseCol, uBayColor, vBay);

        // Fresnel sky reflection (stronger at grazing angles)
        float ndotv = max(dot(N, V), 0.0);
        float fresnel = 0.06 + 0.62 * pow(1.0 - ndotv, 3.2);
        vec3 col = mix(baseCol, uSkyColor, fresnel);

        // Midday sun specular glints
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 140.0) * 0.75 + pow(max(dot(N, H), 0.0), 24.0) * 0.14;
        col += vec3(1.0, 0.97, 0.88) * spec;

        // Subtle shoreline foam / shallow edge shimmer (lake only)
        float ripple = 0.5 + 0.5 * sin(vWorldPos.x * 0.9 + vWorldPos.z * 0.7 + uTime * 1.6);
        float foam = (1.0 - smoothstep(0.0, 0.075 + ripple * 0.02, vShore)) * (1.0 - vBay);
        col = mix(col, uFoamColor, foam * 0.55);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
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

/**
 * Helper: emit a single wall quad with baked vertical Ambient Occlusion (darker base -> bright top)
 * and real-metre UVs mapped into one of the 4 columns of facades.webp.
 */
function pushAoWall(
  pos: number[],
  nor: number[],
  col: number[],
  uv: number[],
  a: V3,
  b: V3,
  c: V3,
  d: V3,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  tint: THREE.Color,
  aoBase = 0.72,
  aoTop = 1.0,
) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L;
  ny /= L;
  nz /= L;

  const verts: [V3, number, number, number][] = [
    [a, u0, v0, aoBase],
    [b, u1, v0, aoBase],
    [c, u0, v1, aoTop],
    [c, u0, v1, aoTop],
    [b, u1, v0, aoBase],
    [d, u1, v1, aoTop],
  ];
  for (const [p, uu, vv, ao] of verts) {
    pos.push(p[0], p[1], p[2]);
    nor.push(nx, ny, nz);
    col.push(tint.r * ao, tint.g * ao, tint.b * ao);
    uv.push(uu, vv);
  }
}

/**
 * Build realistic Melbourne architectural buildings & custom landmarks in ONLY 2 draw calls:
 *  1) `facades`: textured walls with world-scale floor UVs (~3.4m/floor) + baked vertex AO
 *  2) `roofs`: flat roofs with parapets + HVAC boxes, pitched gable roofs on houses,
 *     plus custom low-poly Melbourne landmarks (Lakeside Stadium, MSAC, CBD skyline crowns/spires).
 */
export function buildMelbourneBuildings(
  m: TrackModel,
  terrain: Terrain,
  env: AlbertParkEnvData,
  quality: 'high' | 'low',
): { facades: THREE.BufferGeometry; roofs: THREE.BufferGeometry } {
  const R = rng(20260308);
  const scaleM = env.meta.transform.scale || m.upm; // render units per real metre
  const fPos: number[] = [];
  const fNor: number[] = [];
  const fCol: number[] = [];
  const fUv: number[] = [];
  const roofs = new Mesher();

  const tint = new THREE.Color();

  for (const [cx, cz, rawW, rawD, rawH, yaw, kind] of env.buildings) {
    const w = Math.max(0.7, rawW);
    const d = Math.max(0.7, rawD);
    const h = Math.max(0.6, rawH);
    const inRect = cx >= terrain.rect.x0 && cx <= terrain.rect.x1 && cz >= terrain.rect.z0 && cz <= terrain.rect.z1;
    const baseY = inRect ? terrain.heightAt(cx, cz) - 0.14 : m.bounds.meanY - 0.25;

    // Pick facade atlas column (0=CBD glass, 1=St Kilda office, 2=apartments/render, 3=heritage brick)
    let colIdx: number;
    if (kind === 2) {
      colIdx = R() < 0.62 ? 0 : 1;
    } else if (kind === 0) {
      colIdx = 1;
    } else {
      colIdx = R() < 0.55 ? 2 : 3;
    }
    const u0 = colIdx * 0.25 + 0.004;
    const u1 = (colIdx + 1) * 0.25 - 0.004;

    // Real-metre V scaling: 1 full texture height = 8 floors * 3.4m = 27.2m
    const heightM = h / Math.max(0.05, scaleM);
    const v1 = Math.max(0.18, heightM / 27.2);

    const shade = 0.88 + R() * 0.18;
    tint.setRGB(shade, shade, shade);
    if (kind === 2 && R() < 0.35) tint.lerp(C('#c7dff5'), 0.25);

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const hw = w * 0.5;
    const hd = d * 0.5;
    const pt = (lx: number, y: number, lz: number): V3 => [
      cx + lx * cos - lz * sin,
      baseY + y,
      cz + lx * sin + lz * cos,
    ];

    const b0 = pt(-hw, 0, -hd);
    const b1 = pt(hw, 0, -hd);
    const b2 = pt(hw, 0, hd);
    const b3 = pt(-hw, 0, hd);
    const t0 = pt(-hw, h, -hd);
    const t1 = pt(hw, h, -hd);
    const t2 = pt(hw, h, hd);
    const t3 = pt(-hw, h, hd);

    // 4 textured walls with baked vertex AO
    pushAoWall(fPos, fNor, fCol, fUv, b0, b1, t0, t1, u0, u1, 0, v1, tint);
    pushAoWall(fPos, fNor, fCol, fUv, b1, b2, t1, t2, u0, u1, 0, v1, tint);
    pushAoWall(fPos, fNor, fCol, fUv, b2, b3, t2, t3, u0, u1, 0, v1, tint);
    pushAoWall(fPos, fNor, fCol, fUv, b3, b0, t3, t0, u0, u1, 0, v1, tint);

    // Roof geometry: pitched gable for low residential houses, parapet + HVAC for offices/towers
    const isPitched = quality === 'high' && kind === 1 && h <= 1.25 && Math.min(w, d) < 4.5;
    if (isPitched) {
      const ridgeH = Math.min(w, d) * 0.28;
      const rc = R() < 0.55 ? MELB_PALETTE.roofTerracotta : MELB_PALETTE.roofIron;
      if (w >= d) {
        const rL = pt(-hw, h + ridgeH, 0);
        const rR = pt(hw, h + ridgeH, 0);
        roofs.quad(t0, t1, rL, rR, rc);
        roofs.quad(t2, t3, rR, rL, rc);
        roofs.quad(t3, t0, rL, rL, rc);
        roofs.quad(t1, t2, rR, rR, rc);
      } else {
        const rF = pt(0, h + ridgeH, -hd);
        const rB = pt(0, h + ridgeH, hd);
        roofs.quad(t3, t0, rB, rF, rc);
        roofs.quad(t1, t2, rF, rB, rc);
        roofs.quad(t0, t1, rF, rF, rc);
        roofs.quad(t2, t3, rB, rB, rc);
      }
    } else {
      const roofCol = kind === 2 ? MELB_PALETTE.roofFlat : MELB_PALETTE.roofParapet;
      roofs.quad(t0, t1, t3, t2, roofCol, true);

      // Parapet rim & rooftop HVAC plant box on medium/tall buildings in high quality
      if (quality === 'high' && (kind === 2 || h > 1.3)) {
        const fx = cos;
        const fz = sin;
        const ph = Math.min(0.28, h * 0.08);
        roofs.box([cx, baseY + h + ph * 0.5, cz], fx, fz, [hw * 0.98, ph * 0.5, hd * 0.98], MELB_PALETTE.roofParapet, roofCol);
        if (w > 1.8 && d > 1.8) {
          const hvacH = Math.min(0.65, h * 0.14);
          roofs.box(
            [cx, baseY + h + ph + hvacH * 0.5, cz],
            fx,
            fz,
            [hw * 0.36, hvacH * 0.5, hd * 0.32],
            MELB_PALETTE.roofHvac,
            MELB_PALETTE.roofFlat,
          );
        }
      }
    }
  }

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

  const facades = new THREE.BufferGeometry();
  facades.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  facades.setAttribute('normal', new THREE.Float32BufferAttribute(fNor, 3));
  facades.setAttribute('color', new THREE.Float32BufferAttribute(fCol, 3));
  facades.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
  facades.computeBoundingSphere();

  return { facades, roofs: roofs.geometry() };
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

/**
 * Build ALL 2026 trackside advertising boards, overhead bridge banners, start gantry banner,
 * pit-building roof fascia, grandstand front fascia, braking markers, and run-off decals
 * into ONE textured BufferGeometry mapped to ads.webp / ads_low.webp (1 draw call!).
 */
export function buildMelbourneAdsGeometry(m: TrackModel, lay: Layout, env: AlbertParkEnvData): THREE.BufferGeometry {
  const uvById = new Map<string, [number, number, number, number]>();
  for (const a of env.atlas) uvById.set(a.id, a.uv);
  const white = C('#ffffff');
  const g = new Mesher(true);
  const M = m.M;

  for (const ad of env.ads) {
    const uv = uvById.get(ad.brand);
    if (!uv) continue;
    const i = sampleIdx(m, ad.u);
    const S = ad.side > 0 ? lay.R : lay.L;
    const tx = m.tx[i];
    const tz = m.tz[i];
    const rx = m.rx[i];
    const rz = m.rz[i];

    if (ad.kind === 'decal') {
      const off = ad.side * (S.edge[i] + Math.min(S.barrier[i] - S.edge[i], 3.2 * M) * 0.55);
      const halfL = ad.len * 0.5;
      const halfW = ad.h * 0.5;
      const c = at(m, i, off, 0.024);
      const P = (dl: number, dw: number): V3 => [c[0] + tx * dl + rx * dw, c[1], c[2] + tz * dl + rz * dw];
      g.quad(P(-halfL, -halfW), P(halfL, -halfW), P(-halfL, halfW), P(halfL, halfW), white, true, [uv[0], uv[2], uv[1], uv[3]]);
    } else {
      const off = ad.side * (S.barrier[i] - 0.06 * M);
      const halfL = ad.len * 0.5;
      const h = ad.h * (ad.kind === 'brake' ? 1.0 : 1.05);
      const y0 = ad.kind === 'brake' ? 0.55 * M : 0.1 * M;
      const c = at(m, i, off, 0);
      const P = (dl: number, y: number): V3 => [c[0] + tx * dl, c[1] + y, c[2] + tz * dl];
      if (ad.side < 0) {
        g.quad(P(-halfL, y0), P(halfL, y0), P(-halfL, y0 + h), P(halfL, y0 + h), white, false, [uv[0], uv[2], uv[1], uv[3]]);
      } else {
        g.quad(P(halfL, y0), P(-halfL, y0), P(halfL, y0 + h), P(-halfL, y0 + h), white, false, [uv[0], uv[2], uv[1], uv[3]]);
      }
    }
  }

  // Start gantry title sponsor banner (Qatar Airways 2026) — both faces
  const qatarUv = uvById.get('qatar_airways');
  if (qatarUv) {
    const left = Math.min(lay.L.barrier[0], m.hwL[0] + 1.2 * M);
    const right = m.hwR[0] + 0.6 * M;
    const ph = 7.8 * M;
    const fx = m.tx[0];
    const fz = m.tz[0];
    const rx = m.rx[0];
    const rz = m.rz[0];
    const mid = at(m, 0, (right - left) / 2, ph);
    const hs = (left + right) * 0.48;
    const hh = 0.88 * M;
    const fOff = 0.36 * M;
    const F = (sr: number, sy: number, sf: number): V3 => [
      mid[0] + rx * hs * sr + fx * fOff * sf,
      mid[1] + hh * sy,
      mid[2] + rz * hs * sr + fz * fOff * sf,
    ];
    g.quad(F(-1, -1, -1), F(1, -1, -1), F(-1, 1, -1), F(1, 1, -1), white, false, [qatarUv[0], qatarUv[2], qatarUv[1], qatarUv[3]]);
    g.quad(F(1, -1, 1), F(-1, -1, 1), F(1, 1, 1), F(-1, 1, 1), white, false, [qatarUv[0], qatarUv[2], qatarUv[1], qatarUv[3]]);
  }

  // Branded footbridge fascia panels (both faces)
  for (const br of env.bridges) {
    const uv = uvById.get(br.brand);
    if (!uv) continue;
    const i = sampleIdx(m, br.u);
    const left = lay.L.barrier[i] + 0.8 * M;
    const right = lay.R.barrier[i] + 0.8 * M;
    const h = 6.8 * M;
    const fx = m.tx[i];
    const fz = m.tz[i];
    const rx = m.rx[i];
    const rz = m.rz[i];
    const mid = at(m, i, (right - left) / 2, h);
    const hs = (left + right) * 0.46;
    const hh = 1.05 * M;
    const fOff = 1.24 * M;
    const F = (sr: number, sy: number, sf: number): V3 => [
      mid[0] + rx * hs * sr + fx * fOff * sf,
      mid[1] + hh * sy,
      mid[2] + rz * hs * sr + fz * fOff * sf,
    ];
    g.quad(F(-1, -1, -1), F(1, -1, -1), F(-1, 1, -1), F(1, 1, -1), white, false, [uv[0], uv[2], uv[1], uv[3]]);
    g.quad(F(1, -1, 1), F(-1, -1, 1), F(1, 1, 1), F(-1, 1, 1), white, false, [uv[0], uv[2], uv[1], uv[3]]);
  }

  // Pit building roof fascia (Qatar Airways 2026 title banner along pit straight)
  if (qatarUv) {
    const core = Math.round(lay.pitN * 0.64);
    const pitBase = (i: number) => lay.pitCentre[i] + m.pit.width / 2 + 0.5 * M;
    const panels = 5;
    for (let k = 0; k < panels; k++) {
      const frac = -0.82 + (k + 0.5) * (1.64 / panels);
      const i = wrapIndex(Math.round(frac * core), m.n);
      const off = pitBase(i) - 2.16 * M;
      const halfL = 4.2 * M;
      const y0 = 8.65 * M;
      const y1 = 9.85 * M;
      const c = at(m, i, off, 0);
      const tx = m.tx[i];
      const tz = m.tz[i];
      const P = (dl: number, y: number): V3 => [c[0] + tx * dl, c[1] + y, c[2] + tz * dl];
      g.quad(P(halfL, y0), P(-halfL, y0), P(halfL, y1), P(-halfL, y1), white, false, [qatarUv[0], qatarUv[2], qatarUv[1], qatarUv[3]]);
    }
  }

  // Grandstand front fascia sponsor banners
  const standBrands = ['qatar_airways', 'pirelli', 'aramco', 'heineken', 'tag_heuer', 'dhl', 'msc_cruises', 'amex', 'lenovo', 'f1_2026'];
  env.grandstands.forEach((st, idx) => {
    const uv = uvById.get(standBrands[idx % standBrands.length]);
    if (!uv) return;
    const midU = st.u0 <= st.u1 ? (st.u0 + st.u1) * 0.5 : ((st.u0 + st.u1 + 1) * 0.5) % 1;
    const i = sampleIdx(m, midU);
    const S = st.side > 0 ? lay.R : lay.L;
    const off = st.side * (S.barrier[i] + 1.32 * M);
    const halfL = 4.0 * M;
    const y0 = 0.25 * M;
    const y1 = 1.28 * M;
    const c = at(m, i, off, 0);
    const tx = m.tx[i];
    const tz = m.tz[i];
    const P = (dl: number, y: number): V3 => [c[0] + tx * dl, c[1] + y, c[2] + tz * dl];
    if (st.side < 0) {
      g.quad(P(-halfL, y0), P(halfL, y0), P(-halfL, y1), P(halfL, y1), white, false, [uv[0], uv[2], uv[1], uv[3]]);
    } else {
      g.quad(P(halfL, y0), P(-halfL, y0), P(halfL, y1), P(-halfL, y1), white, false, [uv[0], uv[2], uv[1], uv[3]]);
    }
  });

  return g.geometry();
}
