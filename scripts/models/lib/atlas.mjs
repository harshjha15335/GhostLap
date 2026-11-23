// LIVERY_ATLAS (src/components/three/liveries.ts) region rects, with the car-space ranges
// re-fitted to the W17's surfaces. The team atlases in public/liveries/ use exactly these
// rects, so the same texture works for the procedural car and the W17.
//
// rect: [x, y, w, h] in normalised canvas coordinates (origin top-left, y down)
// u / v: car-space axis mapped across / down the rect (from → to)

const px = (x, y, w, h) => [x / 1024, y / 512, w / 1024, h / 512];

export const W17_ATLAS = {
  bodySideR: { rect: px(0, 0, 508, 112), u: ['z', 2.88, -1.8], v: ['y', 1.2, 0.18] },
  bodySideL: { rect: px(516, 0, 508, 112), u: ['z', -1.8, 2.88], v: ['y', 1.2, 0.18] },
  noseTop: { rect: px(0, 116, 512, 72), u: ['z', 2.88, -1.8], v: ['x', 0.4, -0.4] },
  frontWing: { rect: px(512, 116, 384, 116), u: ['x', 0.92, -0.92], v: ['z', 2.88, 2.15] },
  halo: { rect: px(904, 116, 48, 48), fill: true },
  underside: { rect: px(960, 116, 48, 48), fill: true },
  sidepodR: { rect: px(0, 236, 256, 64), u: ['z', 0.98, -1.42], v: ['y', 0.74, 0.16] },
  sidepodL: { rect: px(260, 236, 256, 64), u: ['z', -1.42, 0.98], v: ['y', 0.74, 0.16] },
  sidepodTopR: { rect: px(0, 304, 256, 72), u: ['z', 0.98, -1.42], v: ['x', 0.2, 0.74] },
  sidepodTopL: { rect: px(260, 304, 256, 72), u: ['z', 0.98, -1.42], v: ['x', -0.74, -0.2] },
  rearWing: { rect: px(520, 236, 256, 124), u: ['x', 0.54, -0.54], v: ['z', -1.95, -2.42] },
  rearEndplateR: { rect: px(780, 236, 116, 148), u: ['z', -1.96, -2.53], v: ['y', 1.0, 0.42] },
  rearEndplateL: { rect: px(900, 236, 116, 148), u: ['z', -2.53, -1.96], v: ['y', 1.0, 0.42] },
  frontEndplateR: { rect: px(0, 380, 128, 92), u: ['z', 2.88, 2.15], v: ['y', 0.7, 0.12] },
  frontEndplateL: { rect: px(132, 380, 128, 92), u: ['z', 2.15, 2.88], v: ['y', 0.7, 0.12] },
};

/**
 * Atlas region for a painted surface point (p) with unit normal (n).
 * Same rules as the procedural car (carGeometry.ts chooseBody / choosePod), plus the
 * W17's wing and sidepod volumes.
 */
export function regionAt(p, n) {
  const [x, y, z] = p;
  const ax = Math.abs(x);
  const R = x >= 0;
  if (n[1] < -0.6) return 'underside';
  if (z < -1.9 && y > 0.4 && (y > 0.75 || ax > 0.3)) {
    if (ax > 0.3 && Math.abs(n[0]) > 0.6) return R ? 'rearEndplateR' : 'rearEndplateL';
    return 'rearWing';
  }
  if (z > 2.1 && (ax > 0.14 || y < 0.28)) {
    if (Math.abs(n[0]) > 0.6) return R ? 'frontEndplateR' : 'frontEndplateL';
    return 'frontWing';
  }
  if (ax > 0.3 && z > -1.42 && z < 0.98 && y < 0.8) {
    if (n[1] > 0.55) return R ? 'sidepodTopR' : 'sidepodTopL';
    return R ? 'sidepodR' : 'sidepodL';
  }
  if (n[1] > 0.66) return 'noseTop';
  return R ? 'bodySideR' : 'bodySideL';
}

/** Normalised atlas coordinate (u right, v DOWN from the top edge) of p inside region id. */
export function atlasCoord(id, p, out) {
  const r = W17_ATLAS[id];
  if (r.fill) {
    out[0] = r.rect[0] + r.rect[2] / 2;
    out[1] = r.rect[1] + r.rect[3] / 2;
    return out;
  }
  const val = (a) => (a === 'x' ? p[0] : a === 'y' ? p[1] : p[2]);
  const t = (m) => Math.min(1, Math.max(0, (val(m[0]) - m[1]) / (m[2] - m[1])));
  out[0] = r.rect[0] + r.rect[2] * t(r.u);
  out[1] = r.rect[1] + r.rect[3] * t(r.v);
  return out;
}
