// Small geometry helpers shared by the W17 pipeline scripts (plain JS, no three.js).

/** Union-find over vertex indices. */
export class DSU {
  constructor(n) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(a) {
    const p = this.p;
    while (p[a] !== a) {
      p[a] = p[p[a]];
      a = p[a];
    }
    return a;
  }
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.p[b] = a;
  }
}

/**
 * Connected components ("islands") of an indexed triangle list. Vertices with identical
 * positions (within `eps`) are treated as connected so UV seams don't split islands.
 * Returns Int32Array island id per triangle + island count.
 */
export function triangleIslands(pos, idx, eps = 1e-5) {
  const nv = pos.length / 3;
  const dsu = new DSU(nv);
  const key = new Map();
  const q = 1 / eps;
  for (let v = 0; v < nv; v++) {
    const k = `${Math.round(pos[v * 3] * q)},${Math.round(pos[v * 3 + 1] * q)},${Math.round(pos[v * 3 + 2] * q)}`;
    const o = key.get(k);
    if (o === undefined) key.set(k, v);
    else dsu.union(o, v);
  }
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    dsu.union(idx[t * 3], idx[t * 3 + 1]);
    dsu.union(idx[t * 3], idx[t * 3 + 2]);
  }
  const remap = new Map();
  const tri = new Int32Array(nt);
  for (let t = 0; t < nt; t++) {
    const r = dsu.find(idx[t * 3]);
    let id = remap.get(r);
    if (id === undefined) {
      id = remap.size;
      remap.set(r, id);
    }
    tri[t] = id;
  }
  return { tri, count: remap.size };
}

/** Axis-aligned bounds + area-weighted centroid for each island. */
export function islandStats(pos, idx, islands) {
  const n = islands.count;
  const st = Array.from({ length: n }, () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], c: [0, 0, 0], area: 0, tris: 0 }));
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    const s = st[islands.tri[t]];
    const a = idx[t * 3];
    const b = idx[t * 3 + 1];
    const c = idx[t * 3 + 2];
    const ar = triArea(pos, a, b, c);
    s.tris++;
    s.area += ar;
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        const x = pos[v * 3 + k];
        if (x < s.min[k]) s.min[k] = x;
        if (x > s.max[k]) s.max[k] = x;
        s.c[k] += (x * (ar + 1e-12)) / 3;
      }
    }
  }
  for (const s of st) for (let k = 0; k < 3; k++) s.c[k] /= s.area + s.tris * 1e-12;
  return st;
}

export function triArea(pos, a, b, c) {
  const ux = pos[b * 3] - pos[a * 3];
  const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
  const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
  const vx = pos[c * 3] - pos[a * 3];
  const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
  const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/** Face normal (unit) of triangle a,b,c into out. */
export function triNormal(pos, a, b, c, out) {
  const ux = pos[b * 3] - pos[a * 3];
  const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
  const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
  const vx = pos[c * 3] - pos[a * 3];
  const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
  const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
  return out;
}
