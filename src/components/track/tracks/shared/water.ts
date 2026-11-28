import * as THREE from 'three';
import type { Point2D } from './types';

/** Chaikin corner-cutting smoothing for closed 2D polygons (removes jagged OSM shoreline kinks). */
export function smoothClosedPoly(poly: Point2D[], iterations = 2): Point2D[] {
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

/** Minimum planar distance from (px, pz) to any edge of a list of closed polygons. */
export function distToPolys(px: number, pz: number, polys: Point2D[][]): number {
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
 * Build smoothed water geometry with interior triangle subdivision and baked shore-distance
 * in vertex `color.r` (0 = shore, 1 = deep middle) and `color.g` (1 = bay/deep outer water).
 */
export function buildWaterGeometry(
  waterPolys: Point2D[][],
  islandPolys: Point2D[][],
  bayPoly: Point2D[],
  waterY: number,
  quality: 'high' | 'low',
  shoreDepthScale = 9.5,
): THREE.BufferGeometry {
  const smoothWaters = waterPolys.map((p) => smoothClosedPoly(p, quality === 'high' ? 2 : 1));
  const smoothIslands = islandPolys.map((p) => smoothClosedPoly(p, 1));
  const allShores = [...smoothWaters, ...smoothIslands];

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];

  const pushTri = (a: [number, number], b: [number, number], c: [number, number], y: number, isBay: boolean) => {
    for (const [vx, vz] of [a, b, c]) {
      pos.push(vx, y, vz);
      nor.push(0, 1, 0);
      const dShore = isBay ? 1.0 : Math.min(1.0, distToPolys(vx, vz, allShores) / shoreDepthScale);
      col.push(dShore, isBay ? 1.0 : 0.0, 0.0);
      uvs.push(vx * 0.06, vz * 0.06);
    }
  };

  const maxEdge = quality === 'high' ? 6.5 : 11.0;
  const emitSubdivided = (a: [number, number], b: [number, number], c: [number, number], y: number, isBay: boolean, depth = 0) => {
    const dab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const dca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    if (depth >= 4 || Math.max(dab, dbc, dca) <= maxEdge) {
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

  for (let pIdx = 0; pIdx < smoothWaters.length; pIdx++) {
    const poly = smoothWaters[pIdx];
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
      emitSubdivided(
        [pAttr.getX(i), -pAttr.getY(i)],
        [pAttr.getX(i + 1), -pAttr.getY(i + 1)],
        [pAttr.getX(i + 2), -pAttr.getY(i + 2)],
        waterY,
        false,
      );
    }
    sg.dispose();
    if (nonIdx !== sg) nonIdx.dispose();
  }

  if (bayPoly.length >= 3) {
    const shape = new THREE.Shape(bayPoly.map(([x, z]) => new THREE.Vector2(x, -z)));
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
 * Shared lightweight daytime GLSL water shader (1 draw call, zero planar reflection passes):
 * - Crossed scrolling procedural wave normals
 * - Baked shore-distance depth tint (shallow turquoise -> deeper blue)
 * - View-dependent Fresnel sky reflection + midday sun specular glints + shoreline foam
 */
export function createDaytimeWaterMaterial(opts?: {
  shallowColor?: string;
  deepColor?: string;
  bayColor?: string;
  skyColor?: string;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(140, 170, 90).normalize() },
      uSkyColor: { value: new THREE.Color(opts?.skyColor ?? '#d2ebff') },
      uShallowColor: { value: new THREE.Color(opts?.shallowColor ?? '#42b2c9') },
      uDeepColor: { value: new THREE.Color(opts?.deepColor ?? '#145a8a') },
      uBayColor: { value: new THREE.Color(opts?.bayColor ?? '#134c78') },
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

        float depthT = smoothstep(0.0, 0.85, vShore);
        vec3 baseCol = mix(uShallowColor, uDeepColor, depthT);
        baseCol = mix(baseCol, uBayColor, vBay);

        float ndotv = max(dot(N, V), 0.0);
        float fresnel = 0.06 + 0.62 * pow(1.0 - ndotv, 3.2);
        vec3 col = mix(baseCol, uSkyColor, fresnel);

        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 140.0) * 0.75 + pow(max(dot(N, H), 0.0), 24.0) * 0.14;
        col += vec3(1.0, 0.97, 0.88) * spec;

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
