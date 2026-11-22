import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { atlasUV, type AtlasRegionId } from './liveries';

/**
 * Procedural 2026-spec F1 car geometry — built once per detail level and cached at module level,
 * so every car instance (22 in replay) shares the same GPU buffers. Only materials are
 * per instance.
 *
 * 2026 Technical Regulations Traits:
 * - Slim aerodynamic droop nose with narrow survival cell
 * - Active-aero front wing with swept mainplane, multi-element flaps and sculpted endplates
 * - Titanium halo with central aerodynamic pylon
 * - Sculpted airbox with intake splitter and T-cam
 * - Deep undercut "waterslide" sidepods tapering into an ultra-tight coke-bottle rear
 * - Underfloor with 4 entrance Venturi strakes, edge strakes and rear diffuser
 * - Active-aero rear wing with drooping spoon mainplane, movable flap, swan-neck pylons and beam wing
 * - Visible push/pull-rod suspension with aerofoil wishbones
 * - 18" covered wheels with authentic Pirelli sidewall markings (P ZERO / PIRELLI) on high detail
 *
 * Conventions: forward = +Z, up = +Y, origin at the floor centre on the ground plane.
 * ~5.4 m long (front wing tip z ≈ +2.9 → rear wing trailing edge z ≈ -2.5), ~1.9 m wide.
 */

export type Detail = 'high' | 'low';
export type MatKey = 'body' | 'carbon' | 'tyre' | 'metal' | 'ring' | 'ersCore' | 'ersWarn';
export type PartKey = 'frontWing' | 'monocoque' | 'floor' | 'sidepodR' | 'sidepodL' | 'ice' | 'ers' | 'gearbox' | 'rearWing';
export type PartMeshes = { mat: MatKey; geo: THREE.BufferGeometry }[];
export type CarGeometry = Record<PartKey, PartMeshes>;

/* ------------------------------------------------------------------ */
/* layout constants (exported so anchors / skid offsets stay in sync)  */
/* ------------------------------------------------------------------ */

export const FRONT_AXLE_Z = 1.75;
export const REAR_AXLE_Z = -1.62;
export const FRONT_TRACK_X = 0.8;
export const REAR_TRACK_X = 0.78;
export const WHEEL_R = 0.36;
const FRONT_W = 0.3;
const REAR_W = 0.375;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Normalise a geometry for merging: non-indexed, position + normal (+ uv when painted). */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.index ? g.toNonIndexed() : g;
  const keepUV = n.userData.atlas === true || n.userData.hasUV === true;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv')) n.deleteAttribute(k);
  n.clearGroups();
  return n;
}

/**
 * Give a body surface UVs into the livery atlas (see LIVERY_ATLAS in liveries.ts). The
 * chooser picks a region per triangle from its face normal and centroid.
 */
type Chooser = (n: THREE.Vector3, c: THREE.Vector3) => AtlasRegionId;
function paint(src: THREE.BufferGeometry, choose: Chooser | AtlasRegionId): THREE.BufferGeometry {
  const g = prep(src);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), ctr = new THREE.Vector3();
  const out: [number, number] = [0, 0];
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const id = typeof choose === 'string' ? choose : choose(n, ctr);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      atlasUV(id, v.x, v.y, v.z, out);
      uv[(i + k) * 2] = out[0];
      uv[(i + k) * 2 + 1] = out[1];
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.userData.atlas = true;
  return g;
}

/** Body shell: tops → noseTop, bottoms → underside, the rest → side by x sign. */
const chooseBody: Chooser = (n, c) => (n.y > 0.72 ? 'noseTop' : n.y < -0.6 ? 'underside' : c.x >= 0 ? 'bodySideR' : 'bodySideL');
const choosePod: Chooser = (n, c) => (n.y > 0.8 ? (c.x >= 0 ? 'sidepodTopR' : 'sidepodTopL') : n.y < -0.75 ? 'underside' : c.x >= 0 ? 'sidepodR' : 'sidepodL');

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list.map(prep), false);
  if (!g) throw new Error('F1Car: geometry merge failed');
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Mirror across the YZ plane (left side from right side) keeping outward-facing winding. */
function mirrorX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = prep(src.clone());
  g.scale(-1, 1, 1);
  for (const name of ['position', 'normal'] as const) {
    const p = g.getAttribute(name) as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Thin rod between two points (suspension arms, mirror stalks, stays). */
function rod(a: [number, number, number], b: [number, number, number], r: number, seg: number, flat = 1) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
  g.scale(1, 1, flat);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

function box(w: number, h: number, d: number, at: [number, number, number], rot?: [number, number, number]) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(...at);
  return g;
}

/** Uniform Catmull-Rom through keyframe values (clamped ends). */
function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Resample keyframes along a spline, `sub` samples per span. */
function resample<T extends Record<string, number>>(keys: T[], sub: number): T[] {
  if (sub <= 1) return keys;
  const out: T[] = [];
  const at = (i: number) => keys[Math.max(0, Math.min(keys.length - 1, i))];
  for (let i = 0; i < keys.length - 1; i++) {
    for (let j = 0; j < sub; j++) {
      const t = j / sub;
      const o = {} as Record<string, number>;
      for (const k of Object.keys(keys[i])) o[k] = cr(at(i - 1)[k], at(i)[k], at(i + 1)[k], at(i + 2)[k], t);
      out.push(o as T);
    }
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/** Skin rings into a surface with caps. */
function skin(rings: THREE.Vector3[][], capStart = true, capEnd = true): THREE.BufferGeometry {
  const R = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < R; k++) {
      const a = i * R + k;
      const b = i * R + ((k + 1) % R);
      const c = (i + 1) * R + k;
      const d = (i + 1) * R + ((k + 1) % R);
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (ring: THREE.Vector3[], front: boolean) => {
    const base = pos.length / 3;
    const c = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / R);
    pos.push(c.x, c.y, c.z);
    for (const p of ring) pos.push(p.x, p.y, p.z);
    for (let k = 0; k < R; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % R);
      if (front) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
  };
  if (capStart) cap(rings[0], true);
  if (capEnd) cap(rings[rings.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

type Sec = { z: number; hw: number; yb: number; yt: number };

/** Superellipse loft — chassis / airbox / engine cover. */
function loft(keys: Sec[], R: number, sub: number, nTop = 2.6, nBot = 4, taper = 0.18) {
  const rings = resample(keys, sub).map((s) => {
    const ring: THREE.Vector3[] = [];
    const mid = (s.yb + s.yt) / 2;
    const hh = (s.yt - s.yb) / 2;
    for (let k = 0; k < R; k++) {
      const th = (k / R) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const n = sn >= 0 ? nTop : nBot;
      const yy = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      const xx = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const tap = 1 - taper * Math.max(0, yy);
      ring.push(new THREE.Vector3(s.hw * xx * tap, mid + hh * yy, s.z));
    }
    return ring;
  });
  return skin(rings);
}

/** Cambered aerofoil swept across a span. */
function wing(o: {
  x0: number;
  x1: number;
  segs: number;
  prof: number;
  chord: (x: number) => number;
  le: (x: number) => [number, number];
  aoa: (x: number) => number;
  thick?: number;
  camber?: number;
}) {
  const th = o.thick ?? 0.1;
  const cam = o.camber ?? 0.06;
  const N = o.prof;
  const top: number[] = [];
  const bot: number[] = [];
  for (let i = 0; i <= o.segs; i++) {
    const x = o.x0 + ((o.x1 - o.x0) * i) / o.segs;
    const ch = o.chord(x);
    const [y0, z0] = o.le(x);
    const a = o.aoa(x);
    for (let j = 0; j <= N; j++) {
      const s = 0.5 - 0.5 * Math.cos((Math.PI * j) / N);
      const yt = 5 * th * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4) * ch;
      const yc = cam * 4 * s * (1 - s) * ch;
      for (const [arr, h] of [
        [top, yc + yt],
        [bot, yc - yt],
      ] as const) {
        const along = s * ch;
        arr.push(x, y0 + along * Math.sin(a) + h * Math.cos(a), z0 - along * Math.cos(a) + h * Math.sin(a));
      }
    }
  }
  const mk = (arr: number[], up: boolean) => {
    const idx: number[] = [];
    const W = N + 1;
    for (let i = 0; i < o.segs; i++)
      for (let j = 0; j < N; j++) {
        const a = i * W + j;
        const b = (i + 1) * W + j;
        const c = i * W + j + 1;
        const d = (i + 1) * W + j + 1;
        if (up) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  return { top: mk(top, true), bot: mk(bot, false) };
}

/** Flat plate in YZ plane from a 2D shape. */
function plateYZ(shape: THREE.Shape, t: number, x: number, hi: boolean) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: hi,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 1,
    curveSegments: hi ? 10 : 3,
  });
  g.translate(0, 0, -t / 2);
  g.rotateY(-Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

/* ------------------------------------------------------------------ */
/* wheels & Pirelli sidewalls                                          */
/* ------------------------------------------------------------------ */

/**
 * Creates outer sidewall ring with planar UVs mapped 0..1 for the Pirelli texture.
 */
function createSidewallRing(x: number, z: number, r: number, hw: number, hi: boolean) {
  const ri = 0.235;
  const ro = 0.358;
  const segs = hi ? 40 : 16;
  const sign = Math.sign(x);
  const posX = x + sign * (hw + 0.003);

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const cos = Math.cos(th);
    const sin = Math.sin(th);

    const yIn = r + sin * ri;
    const zIn = z + cos * ri;
    const yOut = r + sin * ro;
    const zOut = z + cos * ro;

    pos.push(posX, yIn, zIn);
    nor.push(sign, 0, 0);
    uv.push(0.5 + cos * 0.5 * (ri / ro), 0.5 + sin * 0.5 * (ri / ro));

    pos.push(posX, yOut, zOut);
    nor.push(sign, 0, 0);
    uv.push(0.5 + cos * 0.5, 0.5 + sin * 0.5);

    if (i < segs) {
      const a = i * 2;
      const b = a + 1;
      const c = (i + 1) * 2;
      const d = c + 1;
      if (sign > 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.hasUV = true;
  return g;
}

function wheelParts(x: number, z: number, w: number, hi: boolean) {
  const r = WHEEL_R;
  const ri = 0.235;
  const sh = 0.065;
  const seg = hi ? 32 : 12;
  const hw = w / 2;

  // rounded tyre profile
  const prof: THREE.Vector2[] = [];
  const arc = (cx: number, cy: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      prof.push(new THREE.Vector2(cx + Math.cos(a) * sh, cy + Math.sin(a) * sh));
    }
  };
  const n = hi ? 4 : 2;
  prof.push(new THREE.Vector2(ri, -hw + 0.01));
  arc(r - sh, -hw + sh, -Math.PI / 2, 0, n);
  arc(r - sh, hw - sh, 0, Math.PI / 2, n);
  prof.push(new THREE.Vector2(ri, hw - 0.01));

  const tyre = new THREE.LatheGeometry(prof, seg);
  tyre.rotateZ(Math.PI / 2);
  tyre.translate(x, r, z);

  // 2026 aerodynamic covered wheel disc
  const cover = new THREE.CylinderGeometry(ri + 0.003, ri + 0.003, w - 0.024, hi ? 24 : 10, 1, false);
  cover.rotateZ(Math.PI / 2);
  cover.translate(x, r, z);

  // Outer sidewall compound ring (in high detail: planar ring for Pirelli branding; in low: glowing ring)
  let ring: THREE.BufferGeometry;
  if (hi) {
    ring = createSidewallRing(x, z, r, hw, true);
  } else {
    ring = new THREE.TorusGeometry(0.3, 0.018, 3, 16);
    ring.rotateY(Math.PI / 2);
    ring.translate(x + Math.sign(x) * (hw + 0.002), r, z);
  }

  // Wheel nut / hub detail
  const nut = new THREE.CylinderGeometry(0.038, 0.05, 0.045, hi ? 10 : 6);
  nut.rotateZ(Math.PI / 2);
  nut.translate(x + Math.sign(x) * (hw + 0.004), r, z);

  return { tyre, cover, ring, nut };
}

/* ------------------------------------------------------------------ */
/* 2026 Bodywork & Sub-assemblies                                      */
/* ------------------------------------------------------------------ */

// 2026 regulations chassis loft sections
const BODY_KEYS: Sec[] = [
  { z: 2.88, hw: 0.045, yb: 0.12, yt: 0.17 },  // slim drooping nose tip
  { z: 2.62, hw: 0.075, yb: 0.13, yt: 0.23 },  // gentle droop rise
  { z: 2.25, hw: 0.105, yb: 0.145, yt: 0.32 }, // tapering front nosecone
  { z: 1.85, hw: 0.138, yb: 0.155, yt: 0.42 }, // front bulkhead
  { z: 1.4, hw: 0.18, yb: 0.13, yt: 0.52 },    // front suspension zone
  { z: 0.9, hw: 0.23, yb: 0.1, yt: 0.60 },     // monocoque front
  { z: 0.45, hw: 0.27, yb: 0.09, yt: 0.65 },    // cockpit opening
  { z: 0.0, hw: 0.29, yb: 0.09, yt: 0.66 },     // driver survival cell
  { z: -0.4, hw: 0.275, yb: 0.1, yt: 0.70 },    // roll hoop & fuel cell
  { z: -0.9, hw: 0.225, yb: 0.12, yt: 0.68 },   // engine cover taper
  { z: -1.35, hw: 0.155, yb: 0.16, yt: 0.56 },  // coke-bottle waist
  { z: -1.75, hw: 0.095, yb: 0.20, yt: 0.44 },  // rear gearbox cowl
  { z: -2.05, hw: 0.05, yb: 0.24, yt: 0.36 },   // tail cone
];

// Airbox & shark fin
const AIRBOX_KEYS: Sec[] = [
  { z: -0.12, hw: 0.11, yb: 0.6, yt: 0.99 },
  { z: -0.34, hw: 0.12, yb: 0.6, yt: 1.03 },
  { z: -0.72, hw: 0.088, yb: 0.6, yt: 0.93 },
  { z: -1.15, hw: 0.045, yb: 0.57, yt: 0.81 },
  { z: -1.5, hw: 0.015, yb: 0.51, yt: 0.65 },
  { z: -1.82, hw: 0.008, yb: 0.45, yt: 0.52 }, // extended 2026 shark fin
];

function buildMonocoque(hi: boolean): PartMeshes {
  const R = hi ? 24 : 12;
  const sub = hi ? 4 : 1;
  const body = [
    paint(loft(BODY_KEYS, R, sub), chooseBody),
    paint(loft(AIRBOX_KEYS, hi ? 18 : 8, sub, 2.2, 3, 0.25), chooseBody),
  ];

  if (hi) {
    // Aerodynamic rear-view mirrors
    for (const s of [-1, 1]) {
      body.push(paint(box(0.15, 0.055, 0.04, [s * 0.46, 0.72, 0.58], [0, s * 0.22, 0]), chooseBody));
    }
  }

  const carbon: THREE.BufferGeometry[] = [];

  // Cockpit interior opening & headrest padding
  const cockpit = new THREE.SphereGeometry(1, hi ? 20 : 8, hi ? 8 : 4, 0, Math.PI * 2, 0, Math.PI / 2);
  cockpit.scale(0.19, 0.05, 0.35);
  cockpit.translate(0, 0.655, 0.3);
  carbon.push(cockpit);

  // Airbox intake mouth & internal splitter
  const intake = new THREE.CircleGeometry(1, hi ? 16 : 8);
  intake.scale(0.07, 0.095, 1);
  intake.translate(0, 0.86, -0.115);
  carbon.push(intake);
  if (hi) {
    carbon.push(box(0.008, 0.16, 0.05, [0, 0.86, -0.11]));
  }

  // Front suspension wishbones (aerofoil sections) + push-rod + steering arm
  const rs = hi ? 6 : 4;
  for (const s of [-1, 1]) {
    const ux = s * 0.66;
    const z = FRONT_AXLE_Z;
    carbon.push(
      rod([s * 0.13, 0.43, z + 0.24], [ux, 0.46, z], 0.015, rs, 0.5),
      rod([s * 0.13, 0.41, z - 0.3], [ux, 0.46, z], 0.015, rs, 0.5),
      rod([s * 0.1, 0.19, z + 0.26], [ux, 0.21, z], 0.015, rs, 0.5),
      rod([s * 0.1, 0.18, z - 0.28], [ux, 0.21, z], 0.015, rs, 0.5),
      rod([ux - s * 0.03, 0.22, z - 0.02], [s * 0.15, 0.49, z - 0.11], 0.013, rs),
      rod([s * 0.12, 0.29, z + 0.11], [ux, 0.32, z + 0.09], 0.011, rs),
    );
    // Upright / brake duct housing
    carbon.push(box(0.05, 0.29, 0.08, [s * 0.67, 0.34, z]));
    if (hi) {
      carbon.push(rod([s * 0.29, 0.67, 0.62], [s * 0.41, 0.71, 0.58], 0.011, 4));
    }
  }

  // Halo cockpit rim padding & T-cam
  if (hi) {
    const hr = new THREE.TorusGeometry(1, 0.055, 5, 18, Math.PI);
    hr.rotateX(-Math.PI / 2);
    hr.scale(0.19, 1, 0.11);
    hr.translate(0, 0.68, -0.02);
    carbon.push(hr);
    carbon.push(box(0.15, 0.024, 0.045, [0, 1.055, -0.32]), box(0.028, 0.028, 0.028, [0, 1.035, -0.32]));
  }

  // Titanium Halo: aerodynamic hoop + central pylon
  const acc: THREE.BufferGeometry[] = [];
  const hoop = new THREE.CatmullRomCurve3(
    [
      [-0.24, 0.68, -0.14],
      [-0.26, 0.85, 0.0],
      [-0.27, 0.89, 0.22],
      [-0.19, 0.91, 0.46],
      [0, 0.92, 0.61],
      [0.19, 0.91, 0.46],
      [0.27, 0.89, 0.22],
      [0.26, 0.85, 0.0],
      [0.24, 0.68, -0.14],
    ].map((p) => new THREE.Vector3(...(p as [number, number, number]))),
    false,
    'centripetal',
  );
  acc.push(new THREE.TubeGeometry(hoop, hi ? 44 : 16, 0.028, hi ? 8 : 4, false));

  // Central aerodynamic pylon
  const pylon = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.59, 0.96),
    new THREE.Vector3(0, 0.76, 0.77),
    new THREE.Vector3(0, 0.92, 0.61),
  ]);
  const py = new THREE.TubeGeometry(pylon, hi ? 12 : 4, 0.024, hi ? 8 : 4, false);
  py.scale(0.75, 1, 1);
  acc.push(py);

  // Wheels
  const fl = wheelParts(-FRONT_TRACK_X, FRONT_AXLE_Z, FRONT_W, hi);
  const fr = wheelParts(FRONT_TRACK_X, FRONT_AXLE_Z, FRONT_W, hi);
  carbon.push(fl.cover, fr.cover);

  const out: PartMeshes = [
    { mat: 'body', geo: merge([...body, ...acc.map((g) => paint(g, 'halo'))]) },
    { mat: 'carbon', geo: merge(carbon) },
    { mat: 'tyre', geo: merge([fl.tyre, fr.tyre]) },
    { mat: 'ring', geo: merge([fl.ring, fr.ring]) },
  ];
  if (hi) out.push({ mat: 'metal', geo: merge([fl.nut, fr.nut]) });
  return out;
}

function buildFrontWing(hi: boolean): PartMeshes {
  const segs = hi ? 20 : 6;
  const prof = hi ? 8 : 4;
  const tops: THREE.BufferGeometry[] = [];
  const carbon: THREE.BufferGeometry[] = [];
  const plates: THREE.BufferGeometry[] = [];

  // Mainplane across full span: 2026 active aero with subtle center gull-wing droop
  const S = 0.93;
  const main = wing({
    x0: -S,
    x1: S,
    segs: segs * 2,
    prof,
    chord: () => 0.29,
    le: (x) => [0.065 + 0.04 * (x / S) ** 2, 2.90 - 0.045 * (x / S) ** 2],
    aoa: (x) => 0.04 + 0.12 * (x / S) ** 2,
    thick: 0.085,
  });
  tops.push(main.top);
  carbon.push(main.bot);

  // Multi-element secondary & tertiary flaps
  for (const s of [-1, 1]) {
    const flap = (xa: number, le: (u: number) => [number, number], ch: number, aoa: (u: number) => number) => {
      const xb = 0.92;
      const u = (x: number) => (Math.abs(x) - xa) / (xb - xa);
      const w = wing({
        x0: s < 0 ? -xb : xa,
        x1: s < 0 ? -xa : xb,
        segs,
        prof,
        chord: () => ch,
        le: (x) => le(Math.max(0, u(x))),
        aoa: (x) => aoa(Math.max(0, u(x))),
        thick: 0.09,
      });
      tops.push(w.top);
      carbon.push(w.bot);
    };
    flap(0.12, (u) => [0.108 + 0.07 * u ** 1.6, 2.64 - 0.04 * u], 0.165, (u) => 0.32 + 0.34 * u);
    flap(0.19, (u) => [0.165 + 0.105 * u ** 1.6, 2.54 - 0.03 * u], 0.125, (u) => 0.52 + 0.38 * u);

    // 2026-spec tall sculpted endplate with outward curved camber
    const ep = new THREE.Shape();
    ep.moveTo(2.95, 0.025);
    ep.lineTo(2.36, 0.025);
    ep.lineTo(2.33, 0.43);
    ep.quadraticCurveTo(2.48, 0.45, 2.62, 0.36);
    ep.quadraticCurveTo(2.88, 0.22, 2.95, 0.09);
    ep.closePath();
    plates.push(paint(plateYZ(ep, 0.016, s * 0.935, hi), s > 0 ? 'frontEndplateR' : 'frontEndplateL'));

    // Endplate footplate & outer dive plane
    if (hi) {
      carbon.push(box(0.09, 0.01, 0.35, [s * 0.885, 0.03, 2.62]));
      carbon.push(box(0.06, 0.008, 0.18, [s * 0.965, 0.22, 2.58], [0, 0, s * 0.25]));
    }
  }

  // Nose support pylons to front wing
  for (const s of [-1, 1]) {
    carbon.push(box(0.012, 0.075, 0.17, [s * 0.038, 0.115, 2.71]));
  }

  return [
    { mat: 'carbon', geo: merge(carbon) },
    { mat: 'body', geo: merge([...tops.map((g) => paint(g, 'frontWing')), ...plates]) },
  ];
}

function buildFloor(hi: boolean): PartMeshes {
  const half: [number, number][] = [
    [0.21, 1.55],
    [0.44, 1.3],
    [0.67, 1.05],
    [0.79, 0.8],
    [0.80, -0.85],
    [0.72, -1.15],
    [0.55, -1.3],
    [0.45, -1.52],
    [0.41, -1.74],
  ];
  const sh = new THREE.Shape();
  sh.moveTo(half[0][0], half[0][1]);
  for (const [x, z] of half.slice(1)) sh.lineTo(x, z);
  for (const [x, z] of [...half].reverse()) sh.lineTo(-x, z);
  sh.closePath();

  const plate = new THREE.ExtrudeGeometry(sh, {
    depth: 0.026,
    bevelEnabled: hi,
    bevelThickness: 0.006,
    bevelSize: 0.008,
    bevelSegments: 1,
  });
  plate.rotateX(Math.PI / 2);
  plate.translate(0, 0.072, 0);

  const parts: THREE.BufferGeometry[] = [plate];

  for (const s of [-1, 1]) {
    // Floor edge lip & edge-wing vanes
    parts.push(box(0.012, 0.055, 1.58, [s * 0.79, 0.095, -0.05]));
    parts.push(box(0.095, 0.009, 0.88, [s * 0.74, 0.125, -0.2], [0, 0, s * 0.25]));

    // 4 2026 Venturi inlet fences under nose / leading edge
    const fences = hi ? [0.15, 0.25, 0.35, 0.46] : [0.22, 0.4];
    for (const fx of fences) {
      parts.push(box(0.009, 0.13, 0.4, [s * fx, 0.105, 1.18], [0, s * 0.08, 0]));
    }

    // Floor stiffening stay
    if (hi) {
      parts.push(rod([s * 0.62, 0.08, 0.95], [s * 0.42, 0.41, 0.65], 0.007, 4));
    }
  }

  // Wooden skid plank down centerline
  parts.push(box(0.29, 0.011, 2.58, [0, 0.034, 0]));

  return [{ mat: 'carbon', geo: merge(parts) }];
}

/** Right sidepod shell + radiator inlet & cooling louvres. */
function sidepodRight(hi: boolean): { body: THREE.BufferGeometry; carbon: THREE.BufferGeometry | null } {
  type K = { z: number; xo: number; yt: number; ys: number; yu: number };
  const keys: K[] = [
    { z: 0.62, xo: 0.60, yt: 0.64, ys: 0.58, yu: 0.40 }, // front radiator inlet
    { z: 0.38, xo: 0.71, yt: 0.63, ys: 0.56, yu: 0.33 }, // shoulder swell
    { z: 0.02, xo: 0.72, yt: 0.59, ys: 0.49, yu: 0.27 }, // waterslide dip
    { z: -0.48, xo: 0.65, yt: 0.52, ys: 0.41, yu: 0.20 }, // coke bottle start
    { z: -0.96, xo: 0.49, yt: 0.44, ys: 0.32, yu: 0.14 }, // dramatic waist taper
    { z: -1.32, xo: 0.33, yt: 0.39, ys: 0.27, yu: 0.11 }, // tight rear waist
    { z: -1.58, xo: 0.21, yt: 0.35, ys: 0.25, yu: 0.10 }, // engine exit duct
  ];

  const R = hi ? 22 : 10;
  const xi = 0.12;
  const rings = resample(keys, hi ? 4 : 1).map((k) => {
    const w = k.xo - xi;
    const ctrl: [number, number][] = [
      [xi, k.yt],
      [xi, 0.095],
      [xi + 0.22 * w, 0.115],
      [k.xo - 0.16 * w, k.yu - 0.02],
      [k.xo, k.ys - 0.05],
      [k.xo - 0.1 * w, k.ys + 0.01],
      [xi + 0.5 * w, k.yt - 0.025 * (k.yt / 0.6)],
    ];
    const curve = new THREE.CatmullRomCurve3(
      ctrl.map(([x, y]) => new THREE.Vector3(x, y, k.z)),
      true,
      'centripetal',
    );
    return curve.getSpacedPoints(R).slice(0, R);
  });
  const body = skin(rings);

  let carbon: THREE.BufferGeometry | null = null;
  if (hi) {
    // Radiator inlet mouth & cooling gills
    const k = keys[0];
    const mouth = new THREE.Shape();
    mouth.moveTo(0.26, 0.6);
    mouth.quadraticCurveTo(0.55, 0.61, 0.58, 0.54);
    mouth.quadraticCurveTo(0.6, 0.45, 0.49, 0.43);
    mouth.lineTo(0.29, 0.45);
    mouth.closePath();
    const m = new THREE.ShapeGeometry(mouth, 6);
    m.translate(0, 0, k.z + 0.003);

    const louv: THREE.BufferGeometry[] = [m];
    for (let i = 0; i < 5; i++) {
      louv.push(box(0.19, 0.011, 0.032, [0.39, 0.59 - i * 0.014, -0.34 - i * 0.11], [0.05, 0, -0.12]));
    }
    carbon = merge(louv);
  }
  return { body, carbon };
}

function buildIce(hi: boolean): PartMeshes {
  const metal: THREE.BufferGeometry[] = [box(0.33, 0.25, 0.78, [0, 0.38, -0.85])];

  // Turbocharger assembly
  const turbo = new THREE.CylinderGeometry(0.095, 0.095, 0.21, hi ? 16 : 8);
  turbo.rotateZ(Math.PI / 2);
  turbo.translate(0, 0.46, -1.36);
  metal.push(turbo);

  // Central exhaust pipe exiting below rear wing
  const ex = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.46, -1.45),
    new THREE.Vector3(0, 0.44, -1.8),
    new THREE.Vector3(0, 0.45, -2.1),
  ]);
  metal.push(new THREE.TubeGeometry(ex, hi ? 10 : 3, 0.042, hi ? 10 : 6, false));

  const out: PartMeshes = [{ mat: 'metal', geo: merge(metal) }];
  if (hi) {
    // V6 cylinder banks & plenum
    const banks = [-1, 1].map((s) => box(0.115, 0.095, 0.74, [s * 0.13, 0.54, -0.85], [0, 0, s * 0.5]));
    out.push({ mat: 'carbon', geo: merge(banks) });
  }
  return out;
}

function buildErs(hi: boolean): PartMeshes {
  // 350 kW MGU-K motor
  const mguk = new THREE.CylinderGeometry(0.072, 0.072, 0.15, hi ? 14 : 8);
  mguk.translate(0.15, 0.27, -0.6);

  // In low detail, merge into ersCore to ensure car draw calls <= 16
  if (!hi) {
    return [{ mat: 'ersCore', geo: merge([box(0.38, 0.13, 0.55, [0, 0.19, -0.2]), mguk]) }];
  }

  const out: PartMeshes = [
    { mat: 'ersCore', geo: merge([box(0.37, 0.13, 0.54, [0, 0.19, -0.2])]) },
    { mat: 'ersWarn', geo: merge([mguk]) },
  ];
  // Control electronics enclosure
  out.push({ mat: 'carbon', geo: merge([box(0.14, 0.06, 0.19, [-0.12, 0.3, 0.05])]) });
  return out;
}

function buildGearbox(hi: boolean): PartMeshes {
  const carbon: THREE.BufferGeometry[] = [
    loft(
      [
        { z: -1.25, hw: 0.145, yb: 0.17, yt: 0.42 },
        { z: -1.7, hw: 0.115, yb: 0.20, yt: 0.39 },
        { z: -2.08, hw: 0.065, yb: 0.24, yt: 0.33 },
      ],
      hi ? 16 : 8,
      hi ? 3 : 1,
      4,
      4,
      0,
    ),
  ];

  // Rear diffuser ramp & strakes
  const ramp = new THREE.PlaneGeometry(0.98, 0.84, 1, 1);
  ramp.rotateX(-Math.PI / 2 + 0.32);
  ramp.translate(0, 0.17, -1.72);
  carbon.push(ramp);
  const ramp2 = ramp.clone();
  {
    const p = ramp2.index!;
    const a = p.array as Uint16Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
  }
  carbon.push(ramp2);

  // Diffuser vertical fences
  const strakes = hi ? [-0.48, -0.29, -0.1, 0.1, 0.29, 0.48] : [-0.45, 0.45];
  for (const x of strakes) {
    const st = new THREE.Shape();
    st.moveTo(-1.3, 0.05);
    st.lineTo(-2.14, 0.05);
    st.lineTo(-2.14, 0.31);
    st.closePath();
    carbon.push(plateYZ(st, 0.011, x, false));
  }

  // Rear crash structure & FIA rain light
  carbon.push(box(0.095, 0.075, 0.095, [0, 0.29, -2.1]));

  // Rear pull-rod suspension
  const rs = hi ? 6 : 4;
  for (const s of [-1, 1]) {
    const ux = s * 0.58;
    const z = REAR_AXLE_Z;
    carbon.push(
      rod([s * 0.13, 0.41, z + 0.29], [ux, 0.49, z], 0.015, rs, 0.5),
      rod([s * 0.12, 0.39, z - 0.2], [ux, 0.49, z], 0.015, rs, 0.5),
      rod([s * 0.13, 0.21, z + 0.31], [ux, 0.20, z], 0.015, rs, 0.5),
      rod([s * 0.12, 0.21, z - 0.17], [ux, 0.20, z], 0.015, rs, 0.5),
      rod([ux - s * 0.03, 0.46, z + 0.02], [s * 0.15, 0.24, z + 0.15], 0.013, rs),
      box(0.048, 0.31, 0.095, [s * 0.6, 0.35, z]),
    );
  }

  const rl = wheelParts(-REAR_TRACK_X, REAR_AXLE_Z, REAR_W, hi);
  const rr = wheelParts(REAR_TRACK_X, REAR_AXLE_Z, REAR_W, hi);
  carbon.push(rl.cover, rr.cover);

  const out: PartMeshes = [
    { mat: 'carbon', geo: merge(carbon) },
    { mat: 'tyre', geo: merge([rl.tyre, rr.tyre]) },
    { mat: 'ring', geo: merge([rl.ring, rr.ring]) },
  ];
  if (hi) out.push({ mat: 'metal', geo: merge([rl.nut, rr.nut]) });
  return out;
}

function buildRearWing(hi: boolean): PartMeshes {
  const segs = hi ? 18 : 6;
  const prof = hi ? 8 : 4;
  const S = 0.5;

  // 2026 curved spoon mainplane
  const spoon = (x: number) => -0.034 * Math.cos((Math.PI * x) / (2 * S)) ** 2;
  const main = wing({
    x0: -S,
    x1: S,
    segs,
    prof,
    chord: () => 0.29,
    le: (x) => [0.93 + spoon(x), -2.03],
    aoa: () => 0.14,
    thick: 0.095,
  });

  // Movable active-aero upper flap
  const flap = wing({
    x0: -S,
    x1: S,
    segs,
    prof,
    chord: () => 0.185,
    le: (x) => [1.025 + spoon(x) * 0.6, -2.26],
    aoa: () => 0.58,
    thick: 0.095,
  });

  // Lower beam wing
  const beam = wing({
    x0: -0.42,
    x1: 0.42,
    segs: hi ? 10 : 3,
    prof,
    chord: () => 0.145,
    le: () => [0.49, -1.99],
    aoa: () => 0.22,
    thick: 0.095,
  });

  const carbon: THREE.BufferGeometry[] = [main.bot, flap.bot, beam.top, beam.bot];

  // Dual swan-neck wing pylons
  for (const s of [-1, 1]) {
    const sw = new THREE.Shape();
    sw.moveTo(-1.92, 0.42);
    sw.quadraticCurveTo(-1.98, 0.9, -2.08, 0.985);
    sw.lineTo(-2.15, 0.975);
    sw.lineTo(-2.14, 0.94);
    sw.lineTo(-2.08, 0.945);
    sw.quadraticCurveTo(-2.02, 0.86, -1.98, 0.42);
    sw.closePath();
    carbon.push(plateYZ(sw, 0.013, s * 0.06, hi));
  }

  // 2026-spec sculpted endplates
  const body: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const ep = new THREE.Shape();
    ep.moveTo(-1.97, 0.61);
    ep.lineTo(-2.48, 0.57);
    ep.lineTo(-2.51, 1.07);
    ep.quadraticCurveTo(-2.49, 1.19, -2.35, 1.19);
    ep.lineTo(-2.12, 1.14);
    ep.quadraticCurveTo(-1.98, 1.09, -1.96, 0.94);
    ep.closePath();
    body.push(paint(plateYZ(ep, 0.019, s * 0.515, hi), s > 0 ? 'rearEndplateR' : 'rearEndplateL'));
  }

  // Center active DRS actuator pod
  if (hi) {
    carbon.push(box(0.045, 0.045, 0.12, [0, 1.07, -2.2]));
  }

  return [
    { mat: 'body', geo: merge([paint(main.top, 'rearWing'), paint(flap.top, 'rearWing'), ...body]) },
    { mat: 'carbon', geo: merge(carbon) },
  ];
}

/* ------------------------------------------------------------------ */
/* cache                                                               */
/* ------------------------------------------------------------------ */

const cache: Partial<Record<Detail, CarGeometry>> = {};

export function getCarGeometry(detail: Detail): CarGeometry {
  const hit = cache[detail];
  if (hit) return hit;
  const hi = detail === 'high';
  const pod = sidepodRight(hi);
  const podR: PartMeshes = [{ mat: 'body', geo: merge([paint(pod.body, choosePod)]) }];
  const podL: PartMeshes = [{ mat: 'body', geo: merge([paint(mirrorX(pod.body), choosePod)]) }];
  if (pod.carbon) {
    podR.push({ mat: 'carbon', geo: pod.carbon });
    podL.push({ mat: 'carbon', geo: mirrorX(pod.carbon) });
  }
  const g: CarGeometry = {
    frontWing: buildFrontWing(hi),
    monocoque: buildMonocoque(hi),
    floor: buildFloor(hi),
    sidepodR: podR,
    sidepodL: podL,
    ice: buildIce(hi),
    ers: buildErs(hi),
    gearbox: buildGearbox(hi),
    rearWing: buildRearWing(hi),
  };
  cache[detail] = g;
  return g;
}

/** Triangle / mesh counts for a detail level (dev diagnostics). */
export function carStats(detail: Detail) {
  const g = getCarGeometry(detail);
  let tris = 0;
  let meshes = 0;
  for (const part of Object.values(g))
    for (const m of part) {
      meshes++;
      tris += (m.geo.index ? m.geo.index.count : m.geo.getAttribute('position').count) / 3;
    }
  return { tris, meshes };
}
