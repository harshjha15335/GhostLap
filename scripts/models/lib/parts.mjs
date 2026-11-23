// Split the W17 into GhostLap's explodable sub-assemblies (CarPartId in F1Car.tsx).
// Car space: forward +Z, up +Y, x = car's left/right, metres, tyres on y = 0.
//
// Islands (connected pieces) are assigned whole by their centroid; the few large shells
// (nose + chassis + sidepod skin, the floor tray) are cut per triangle.
//
// Output part ids: frontWing, monocoque, floor, sidepodL, sidepodR, gearbox, rearWing
// (ICE / ERS have no visible geometry in the model; F1Car adds simple internals for them).

export const PART_IDS = ['frontWing', 'monocoque', 'floor', 'sidepodL', 'sidepodR', 'gearbox', 'rearWing'];

const FRONT_AXLE_Z = 1.62;
const REAR_AXLE_Z = -1.78;
const WHEEL_MATS = new Set(['mercedes_wheel_hub', 'sidewall', 'tread_medium', 'discs']);

/** island bbox counts as "large" (gets cut per triangle) */
const isLarge = (s) => s.max[2] - s.min[2] > 1.4 && s.tris > 2000;

const nearWheel = (x, y, z, axleZ, r = 0.42) => Math.abs(x) > 0.45 && Math.abs(z - axleZ) < r && y < 0.75;

/** Part for a point (triangle centroid / island centroid) — the shared spatial rules. */
export function partAt(x, y, z, mat, ext = null) {
  const ax = Math.abs(x);
  const side = x >= 0 ? 'sidepodR' : 'sidepodL';
  // wheels, brakes, uprights
  if (WHEEL_MATS.has(mat) || nearWheel(x, y, z, FRONT_AXLE_Z) || nearWheel(x, y, z, REAR_AXLE_Z)) return z > 0 ? 'monocoque' : 'gearbox';
  // rear wing: mainplane, flap, endplates, swan-neck pylon, beam wing
  if (z < -1.88 && y > 0.6) return 'rearWing';
  if (z < -2.12 && y > 0.4 && ax > 0.3) return 'rearWing';
  // front wing: everything ahead of the front axle that is wider than the nose or below it
  if (ext && z > 1.9 && ext.width > 0.9 && ext.height < 0.7) return 'frontWing';
  if (z > 2.05 && (ax > 0.14 || y < 0.24)) return 'frontWing';
  if (z > 1.95 && y < 0.3 && ax > 0.1) return 'frontWing';
  // floor: the low tray, fences and edge wings
  if (y < 0.2 && z < 1.3) return 'floor';
  if (ext && ext.height < 0.12 && ext.cy < 0.26 && z < 1.3) return 'floor';
  // gearbox, rear suspension, diffuser, rear crash structure
  if (z < -1.38) return 'gearbox';
  // sidepods: outboard of the chassis between the front suspension and the rear
  if (ax > 0.3 && z > -1.38 && z < 0.98 && y < 0.9) return side;
  return 'monocoque';
}

/**
 * Part id for every triangle of a primitive.
 * @param pos Float32Array positions, idx index array, isl islands, st island stats, mat material base name
 */
export function classifyTriangles(pos, idx, isl, st, mat) {
  const nt = idx.length / 3;
  const out = new Array(nt);
  const islandPart = st.map((s) => (isLarge(s) ? null : partAt(s.c[0], s.c[1], s.c[2], mat, { height: s.max[1] - s.min[1], width: s.max[0] - s.min[0], cy: s.c[1] })));
  for (let t = 0; t < nt; t++) {
    const p = islandPart[isl.tri[t]];
    if (p) {
      out[t] = p;
      continue;
    }
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const x = (pos[a] + pos[b] + pos[c]) / 3;
    const y = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    const z = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    out[t] = partAt(x, y, z, mat);
  }
  return out;
}
