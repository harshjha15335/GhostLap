import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural geometry for F1Car — built once per detail level and cached at module level,
 * so every car instance (22 in replay) shares the same GPU buffers. Only materials are
 * per instance.
 *
 * Car space: forward = +Z, up = +Y, origin at the floor centre on the ground plane.
 * ~5.4 m long (front wing tip z ≈ +2.9 → rear wing trailing edge z ≈ -2.5), ~1.9 m wide.
 */

export type Detail = 'high' | 'low';
export type MatKey = 'body' | 'carbon' | 'acc' | 'tyre' | 'metal' | 'ring' | 'ersCore' | 'ersWarn';
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

/** Normalise a geometry for merging: non-indexed, position + normal only. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  n.clearGroups();
  return n;
}

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
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Thin rod between two points (suspension arms, mirror stalks). */
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

/** Resample keyframes (objects with numeric fields) along a spline, `sub` samples per span. */
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

/**
 * Skin a list of rings (each ring CCW seen from +Z, all the same length, rings ordered
 * front → back) into a closed surface with optional fan caps.
 */
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

/** Rounded-box ("superellipse") loft — the sculpted chassis / engine cover / gearbox. */
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
      const tap = 1 - taper * Math.max(0, yy); // narrower at the top
      ring.push(new THREE.Vector3(s.hw * xx * tap, mid + hh * yy, s.z));
    }
    return ring;
  });
  return skin(rings);
}

/**
 * Wing element — cambered aerofoil swept across a span. Returns top (pressure) and bottom
 * surfaces separately so tops can take the accent livery and bottoms carbon.
 */
function wing(o: {
  x0: number;
  x1: number;
  segs: number;
  prof: number;
  chord: (x: number) => number;
  le: (x: number) => [number, number]; // leading edge (y, z) at span x
  aoa: (x: number) => number; // trailing edge up (rad)
  thick?: number;
  camber?: number;
  dir?: 1 | -1; // chord runs towards -Z (front & rear wings both: 1)
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
      const s = 0.5 - 0.5 * Math.cos((Math.PI * j) / N); // cosine spacing
      const yt = 5 * th * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4) * ch;
      const yc = cam * 4 * s * (1 - s) * ch; // concave-up camber (downforce element seen upside-down)
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

/** Flat plate in the YZ plane from a 2D outline given as (z, y) points; thickness along X. */
function plateYZ(shape: THREE.Shape, t: number, x: number, hi: boolean) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: hi,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: hi ? 10 : 3,
  });
  g.translate(0, 0, -t / 2);
  g.rotateY(-Math.PI / 2); // shape u → world z, v → world y, depth → world -x
  g.translate(x, 0, 0);
  return g;
}

/* ------------------------------------------------------------------ */
/* wheels                                                              */
/* ------------------------------------------------------------------ */

function wheelParts(x: number, z: number, w: number, hi: boolean) {
  const r = WHEEL_R;
  const ri = 0.235;
  const sh = 0.07;
  const seg = hi ? 44 : 14;
  // rounded tyre cross-section revolved about the axle
  const prof: THREE.Vector2[] = [];
  const hw = w / 2;
  const arc = (cx: number, cy: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      prof.push(new THREE.Vector2(cx + Math.cos(a) * sh, cy + Math.sin(a) * sh));
    }
  };
  const n = hi ? 5 : 2;
  prof.push(new THREE.Vector2(ri, -hw + 0.012));
  arc(r - sh, -hw + sh, -Math.PI / 2, 0, n);
  arc(r - sh, hw - sh, 0, Math.PI / 2, n);
  prof.push(new THREE.Vector2(ri, hw - 0.012));
  const tyre = new THREE.LatheGeometry(prof, seg);
  tyre.rotateZ(Math.PI / 2);
  tyre.translate(x, r, z);

  // covered wheel (2026 wheel covers) — dark disc recessed in the tyre
  const cover = new THREE.CylinderGeometry(ri + 0.004, ri + 0.004, w - 0.03, hi ? 32 : 10, 1, false);
  cover.rotateZ(Math.PI / 2);
  cover.translate(x, r, z);

  // compound ring on the outer sidewall
  const ring = new THREE.TorusGeometry(0.3, hi ? 0.016 : 0.02, hi ? 6 : 3, hi ? 48 : 16);
  ring.rotateY(Math.PI / 2);
  ring.translate(x + Math.sign(x) * (hw + 0.002), r, z);

  // wheel nut / hub cap
  const nut = new THREE.CylinderGeometry(0.035, 0.05, 0.05, hi ? 12 : 6);
  nut.rotateZ(Math.PI / 2);
  nut.translate(x + Math.sign(x) * (hw - 0.005), r, z);

  return { tyre, cover, ring, nut };
}

/* ------------------------------------------------------------------ */
/* builders per sub-assembly                                           */
/* ------------------------------------------------------------------ */

const BODY_KEYS: Sec[] = [
  { z: 2.8, hw: 0.05, yb: 0.13, yt: 0.19 },
  { z: 2.55, hw: 0.085, yb: 0.135, yt: 0.26 },
  { z: 2.2, hw: 0.11, yb: 0.15, yt: 0.35 },
  { z: 1.8, hw: 0.145, yb: 0.16, yt: 0.45 },
  { z: 1.3, hw: 0.19, yb: 0.13, yt: 0.55 },
  { z: 0.85, hw: 0.24, yb: 0.1, yt: 0.62 },
  { z: 0.45, hw: 0.28, yb: 0.09, yt: 0.66 },
  { z: 0.0, hw: 0.3, yb: 0.09, yt: 0.67 },
  { z: -0.4, hw: 0.29, yb: 0.1, yt: 0.71 },
  { z: -0.9, hw: 0.24, yb: 0.13, yt: 0.69 },
  { z: -1.35, hw: 0.17, yb: 0.17, yt: 0.57 },
  { z: -1.75, hw: 0.11, yb: 0.21, yt: 0.46 },
  { z: -2.0, hw: 0.06, yb: 0.25, yt: 0.38 },
];

const AIRBOX_KEYS: Sec[] = [
  { z: -0.1, hw: 0.115, yb: 0.6, yt: 0.99 },
  { z: -0.32, hw: 0.125, yb: 0.6, yt: 1.03 },
  { z: -0.7, hw: 0.095, yb: 0.6, yt: 0.93 },
  { z: -1.1, hw: 0.05, yb: 0.58, yt: 0.8 },
  { z: -1.45, hw: 0.018, yb: 0.52, yt: 0.64 },
];

function buildMonocoque(hi: boolean): PartMeshes {
  const R = hi ? 28 : 12;
  const sub = hi ? 4 : 1;
  const body = [loft(BODY_KEYS, R, sub), loft(AIRBOX_KEYS, hi ? 20 : 8, sub, 2.2, 3, 0.25)];
  if (hi) {
    // mirrors: housing (body colour) — stalks go in carbon
    for (const s of [-1, 1]) body.push(box(0.15, 0.06, 0.04, [s * 0.47, 0.73, 0.6], [0, s * 0.25, 0]));
  }

  const carbon: THREE.BufferGeometry[] = [];
  // cockpit opening + headrest
  const cockpit = new THREE.SphereGeometry(1, hi ? 24 : 10, hi ? 10 : 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cockpit.scale(0.2, 0.05, 0.36);
  cockpit.translate(0, 0.665, 0.3);
  carbon.push(cockpit);
  // airbox intake mouth
  const intake = new THREE.CircleGeometry(1, hi ? 20 : 8);
  intake.scale(0.075, 0.1, 1);
  intake.translate(0, 0.86, -0.095);
  carbon.push(intake);
  // front suspension: wishbones + pushrod + track rod, per side
  const rs = hi ? 6 : 4;
  for (const s of [-1, 1]) {
    const ux = s * 0.66;
    const z = FRONT_AXLE_Z;
    carbon.push(
      rod([s * 0.13, 0.44, z + 0.25], [ux, 0.47, z], 0.016, rs, 0.5),
      rod([s * 0.13, 0.42, z - 0.32], [ux, 0.47, z], 0.016, rs, 0.5),
      rod([s * 0.1, 0.2, z + 0.28], [ux, 0.22, z], 0.016, rs, 0.5),
      rod([s * 0.1, 0.19, z - 0.3], [ux, 0.22, z], 0.016, rs, 0.5),
      rod([ux - s * 0.03, 0.23, z - 0.02], [s * 0.15, 0.5, z - 0.12], 0.014, rs),
      rod([s * 0.12, 0.3, z + 0.12], [ux, 0.33, z + 0.1], 0.011, rs),
    );
    // upright
    carbon.push(box(0.05, 0.3, 0.08, [s * 0.67, 0.35, z]));
    if (hi) carbon.push(rod([s * 0.3, 0.68, 0.64], [s * 0.42, 0.72, 0.6], 0.012, 6));
  }
  // halo legs meet the body / cockpit rim padding
  if (hi) {
    const hr = new THREE.TorusGeometry(1, 0.06, 6, 24, Math.PI);
    hr.rotateX(-Math.PI / 2);
    hr.scale(0.2, 1, 0.12);
    hr.translate(0, 0.69, -0.02);
    carbon.push(hr);
  }
  // T-cam
  if (hi) carbon.push(box(0.16, 0.025, 0.05, [0, 1.06, -0.3]), box(0.03, 0.03, 0.03, [0, 1.04, -0.3]));

  // halo (accent): hoop + centre pylon
  const acc: THREE.BufferGeometry[] = [];
  const hoop = new THREE.CatmullRomCurve3(
    [
      [-0.25, 0.69, -0.14],
      [-0.27, 0.86, 0.0],
      [-0.28, 0.9, 0.22],
      [-0.2, 0.92, 0.47],
      [0, 0.93, 0.62],
      [0.2, 0.92, 0.47],
      [0.28, 0.9, 0.22],
      [0.27, 0.86, 0.0],
      [0.25, 0.69, -0.14],
    ].map((p) => new THREE.Vector3(...(p as [number, number, number]))),
    false,
    'centripetal',
  );
  acc.push(new THREE.TubeGeometry(hoop, hi ? 64 : 16, 0.03, hi ? 8 : 4, false));
  const pylon = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.6, 0.98), new THREE.Vector3(0, 0.78, 0.78), new THREE.Vector3(0, 0.93, 0.62)]);
  const py = new THREE.TubeGeometry(pylon, hi ? 12 : 4, 0.026, hi ? 8 : 4, false);
  py.scale(0.8, 1, 1);
  acc.push(py);

  const fl = wheelParts(-FRONT_TRACK_X, FRONT_AXLE_Z, FRONT_W, hi);
  const fr = wheelParts(FRONT_TRACK_X, FRONT_AXLE_Z, FRONT_W, hi);
  carbon.push(fl.cover, fr.cover);

  const out: PartMeshes = [
    { mat: 'body', geo: merge(body) },
    { mat: 'carbon', geo: merge(carbon) },
    { mat: 'acc', geo: merge(acc) },
    { mat: 'tyre', geo: merge([fl.tyre, fr.tyre]) },
    { mat: 'ring', geo: merge([fl.ring, fr.ring]) },
  ];
  if (hi) out.push({ mat: 'metal', geo: merge([fl.nut, fr.nut]) });
  return out;
}

function buildFrontWing(hi: boolean): PartMeshes {
  const segs = hi ? 24 : 6;
  const prof = hi ? 10 : 4;
  const tops: THREE.BufferGeometry[] = [];
  const carbon: THREE.BufferGeometry[] = [];
  // mainplane across the full span
  const S = 0.93;
  const main = wing({
    x0: -S,
    x1: S,
    segs: segs * 2,
    prof,
    chord: () => 0.3,
    le: (x) => [0.07 + 0.04 * (x / S) ** 2, 2.88 - 0.04 * (x / S) ** 2],
    aoa: (x) => 0.05 + 0.12 * (x / S) ** 2,
    thick: 0.09,
  });
  carbon.push(main.top, main.bot);
  // two flaps per side, rising outboard to the endplates
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
        thick: 0.1,
      });
      tops.push(w.top);
      carbon.push(w.bot);
    };
    flap(0.12, (u) => [0.112 + 0.07 * u ** 1.6, 2.62 - 0.04 * u], 0.17, (u) => 0.35 + 0.35 * u);
    flap(0.2, (u) => [0.17 + 0.11 * u ** 1.6, 2.53 - 0.03 * u], 0.13, (u) => 0.55 + 0.4 * u);
    // tall curved endplate
    const ep = new THREE.Shape();
    ep.moveTo(2.93, 0.03);
    ep.lineTo(2.38, 0.03);
    ep.lineTo(2.35, 0.42);
    ep.quadraticCurveTo(2.5, 0.44, 2.64, 0.35);
    ep.quadraticCurveTo(2.86, 0.2, 2.93, 0.1);
    ep.closePath();
    carbon.push(plateYZ(ep, 0.018, s * 0.935, hi));
    // little foot / canard at the endplate base
    if (hi) carbon.push(box(0.1, 0.012, 0.36, [s * 0.88, 0.035, 2.62]));
  }
  // nose pillars down to the mainplane
  for (const s of [-1, 1]) carbon.push(box(0.012, 0.08, 0.18, [s * 0.04, 0.12, 2.7]));
  return [
    { mat: 'carbon', geo: merge(carbon) },
    { mat: 'acc', geo: merge(tops) },
  ];
}

function buildFloor(hi: boolean): PartMeshes {
  const half: [number, number][] = [
    [0.22, 1.55],
    [0.45, 1.3],
    [0.68, 1.06],
    [0.79, 0.8],
    [0.8, -0.85],
    [0.72, -1.12],
    [0.56, -1.28],
    [0.46, -1.5],
    [0.42, -1.72],
  ];
  const sh = new THREE.Shape();
  sh.moveTo(half[0][0], half[0][1]);
  for (const [x, z] of half.slice(1)) sh.lineTo(x, z);
  for (const [x, z] of [...half].reverse()) sh.lineTo(-x, z);
  sh.closePath();
  const plate = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: hi, bevelThickness: 0.008, bevelSize: 0.01, bevelSegments: 1 });
  plate.rotateX(Math.PI / 2); // shape y → world z, depth → world -y
  plate.translate(0, 0.075, 0);
  const parts: THREE.BufferGeometry[] = [plate];
  for (const s of [-1, 1]) {
    // floor-edge lip + edge wing
    parts.push(box(0.012, 0.06, 1.6, [s * 0.79, 0.1, -0.05]));
    parts.push(box(0.1, 0.01, 0.9, [s * 0.74, 0.13, -0.2], [0, 0, s * 0.25]));
    // floor fences under the nose / front of the tunnels
    for (const fx of hi ? [0.16, 0.26, 0.36, 0.46] : [0.22, 0.4]) parts.push(box(0.01, 0.14, 0.42, [s * fx, 0.11, 1.18], [0, s * 0.08, 0]));
    // stays
    if (hi) parts.push(rod([s * 0.62, 0.08, 0.95], [s * 0.42, 0.42, 0.65], 0.008, 4));
  }
  // skid plank
  parts.push(box(0.3, 0.012, 2.6, [0, 0.035, 0]));
  return [{ mat: 'carbon', geo: merge(parts) }];
}

function sidepodRight(hi: boolean): { body: THREE.BufferGeometry; carbon: THREE.BufferGeometry | null } {
  type K = { z: number; xo: number; yt: number; ys: number; yu: number };
  const keys: K[] = [
    { z: 0.62, xo: 0.6, yt: 0.6, ys: 0.54, yu: 0.34 },
    { z: 0.4, xo: 0.71, yt: 0.6, ys: 0.54, yu: 0.3 },
    { z: 0.05, xo: 0.73, yt: 0.58, ys: 0.5, yu: 0.26 },
    { z: -0.45, xo: 0.66, yt: 0.52, ys: 0.42, yu: 0.2 },
    { z: -0.95, xo: 0.5, yt: 0.45, ys: 0.33, yu: 0.15 },
    { z: -1.3, xo: 0.34, yt: 0.4, ys: 0.28, yu: 0.12 },
    { z: -1.55, xo: 0.22, yt: 0.36, ys: 0.26, yu: 0.11 },
  ];
  const R = hi ? 24 : 10;
  const xi = 0.12;
  const rings = resample(keys, hi ? 4 : 1).map((k) => {
    const w = k.xo - xi;
    // CCW seen from +Z: inner-top → inner-bottom → undercut → outer → shoulder → top
    const ctrl: [number, number][] = [
      [xi, k.yt],
      [xi, 0.095],
      [xi + 0.35 * w, 0.11],
      [k.xo - 0.08 * w, k.yu],
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
    // dark radiator inlet mouth + cooling louvres
    const k = keys[0];
    const mouth = new THREE.Shape();
    mouth.moveTo(0.27, 0.56);
    mouth.quadraticCurveTo(0.56, 0.57, 0.585, 0.5);
    mouth.quadraticCurveTo(0.6, 0.42, 0.5, 0.4);
    mouth.lineTo(0.3, 0.42);
    mouth.closePath();
    const m = new THREE.ShapeGeometry(mouth, 6);
    m.translate(0, 0, k.z + 0.004);
    const louv: THREE.BufferGeometry[] = [m];
    for (let i = 0; i < 5; i++) louv.push(box(0.2, 0.012, 0.035, [0.4, 0.57 - i * 0.012, -0.35 - i * 0.11], [0.05, 0, -0.12]));
    carbon = merge(louv);
  }
  return { body, carbon };
}

function buildIce(hi: boolean): PartMeshes {
  const metal: THREE.BufferGeometry[] = [box(0.34, 0.26, 0.8, [0, 0.38, -0.85])];
  const turbo = new THREE.CylinderGeometry(0.1, 0.1, 0.22, hi ? 20 : 8);
  turbo.rotateZ(Math.PI / 2);
  turbo.translate(0, 0.46, -1.36);
  metal.push(turbo);
  // single central exhaust exiting under the rear wing
  const ex = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.46, -1.45), new THREE.Vector3(0, 0.44, -1.8), new THREE.Vector3(0, 0.45, -2.08)]);
  metal.push(new THREE.TubeGeometry(ex, hi ? 10 : 3, 0.045, hi ? 12 : 6, false));
  const out: PartMeshes = [{ mat: 'metal', geo: merge(metal) }];
  if (hi) {
    const banks = [-1, 1].map((s) => box(0.12, 0.1, 0.76, [s * 0.13, 0.55, -0.85], [0, 0, s * 0.5]));
    out.push({ mat: 'carbon', geo: merge(banks) });
  }
  return out;
}

function buildErs(hi: boolean): PartMeshes {
  const mguk = new THREE.CylinderGeometry(0.075, 0.075, 0.16, hi ? 16 : 8);
  mguk.translate(0.15, 0.27, -0.6);
  const out: PartMeshes = [
    { mat: 'ersCore', geo: merge([box(0.38, 0.13, 0.55, [0, 0.19, -0.2])]) },
    { mat: 'ersWarn', geo: merge([mguk]) },
  ];
  if (hi) out.push({ mat: 'carbon', geo: merge([box(0.14, 0.06, 0.2, [-0.12, 0.3, 0.05])]) });
  return out;
}

function buildGearbox(hi: boolean): PartMeshes {
  const carbon: THREE.BufferGeometry[] = [
    loft(
      [
        { z: -1.25, hw: 0.15, yb: 0.17, yt: 0.43 },
        { z: -1.7, hw: 0.12, yb: 0.2, yt: 0.4 },
        { z: -2.08, hw: 0.07, yb: 0.24, yt: 0.34 },
      ],
      hi ? 16 : 8,
      hi ? 3 : 1,
      4,
      4,
      0,
    ),
  ];
  // diffuser ramp + strakes
  const ramp = new THREE.PlaneGeometry(1.0, 0.85, 1, 1);
  ramp.rotateX(-Math.PI / 2 + 0.32);
  ramp.translate(0, 0.17, -1.72);
  carbon.push(ramp);
  const ramp2 = ramp.clone(); // second face (opposite winding) so the ramp reads from below too
  {
    const p = ramp2.index!;
    const a = p.array as Uint16Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
  }
  carbon.push(ramp2);
  for (const x of hi ? [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5] : [-0.5, 0.5]) {
    const st = new THREE.Shape();
    st.moveTo(-1.3, 0.05);
    st.lineTo(-2.13, 0.05);
    st.lineTo(-2.13, 0.32);
    st.closePath();
    carbon.push(plateYZ(st, 0.012, x, false));
  }
  // rain light / crash structure
  carbon.push(box(0.1, 0.08, 0.1, [0, 0.3, -2.1]));
  // rear suspension: wishbones + pullrod
  const rs = hi ? 6 : 4;
  for (const s of [-1, 1]) {
    const ux = s * 0.58;
    const z = REAR_AXLE_Z;
    carbon.push(
      rod([s * 0.13, 0.42, z + 0.3], [ux, 0.5, z], 0.016, rs, 0.5),
      rod([s * 0.12, 0.4, z - 0.2], [ux, 0.5, z], 0.016, rs, 0.5),
      rod([s * 0.13, 0.22, z + 0.32], [ux, 0.21, z], 0.016, rs, 0.5),
      rod([s * 0.12, 0.22, z - 0.18], [ux, 0.21, z], 0.016, rs, 0.5),
      rod([ux - s * 0.03, 0.47, z + 0.02], [s * 0.15, 0.25, z + 0.15], 0.014, rs),
      box(0.05, 0.32, 0.1, [s * 0.6, 0.36, z]),
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
  const segs = hi ? 20 : 6;
  const prof = hi ? 10 : 4;
  const S = 0.5;
  const spoon = (x: number) => -0.035 * Math.cos((Math.PI * x) / (2 * S)) ** 2;
  const main = wing({ x0: -S, x1: S, segs, prof, chord: () => 0.3, le: (x) => [0.93 + spoon(x), -2.02], aoa: () => 0.14, thick: 0.1 });
  const flap = wing({ x0: -S, x1: S, segs, prof, chord: () => 0.19, le: (x) => [1.03 + spoon(x) * 0.6, -2.25], aoa: () => 0.6, thick: 0.1 });
  const beam = wing({ x0: -0.42, x1: 0.42, segs: hi ? 10 : 3, prof, chord: () => 0.15, le: () => [0.5, -1.98], aoa: () => 0.22, thick: 0.1 });
  const carbon: THREE.BufferGeometry[] = [main.bot, flap.bot, beam.top, beam.bot];
  // swan-neck pillars
  for (const s of [-1, 1]) {
    const sw = new THREE.Shape();
    sw.moveTo(-1.9, 0.4);
    sw.lineTo(-1.95, 0.86);
    sw.quadraticCurveTo(-1.98, 1.02, -2.1, 1.01);
    sw.lineTo(-2.17, 0.97);
    sw.lineTo(-2.15, 0.93);
    sw.lineTo(-2.08, 0.94);
    sw.quadraticCurveTo(-2.03, 0.94, -2.03, 0.86);
    sw.lineTo(-1.99, 0.4);
    sw.closePath();
    carbon.push(plateYZ(sw, 0.022, s * 0.07, hi));
  }
  // endplates (body colour) with rounded top
  const body: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const ep = new THREE.Shape();
    ep.moveTo(-1.97, 0.62);
    ep.lineTo(-2.47, 0.58);
    ep.lineTo(-2.5, 1.08);
    ep.quadraticCurveTo(-2.48, 1.2, -2.34, 1.2);
    ep.lineTo(-2.12, 1.15);
    ep.quadraticCurveTo(-1.98, 1.1, -1.96, 0.95);
    ep.closePath();
    body.push(plateYZ(ep, 0.02, s * 0.515, hi));
  }
  return [
    { mat: 'acc', geo: merge([main.top, flap.top]) },
    { mat: 'carbon', geo: merge(carbon) },
    { mat: 'body', geo: merge(body) },
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
  const podR: PartMeshes = [{ mat: 'body', geo: merge([pod.body]) }];
  const podL: PartMeshes = [{ mat: 'body', geo: mirrorX(pod.body) }];
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
