import * as THREE from 'three';
import { Mesher, type V3 } from '../../mesher';
import { wrapIndex, type TrackModel } from '../../trackModel';
import { at, type Layout } from '../../geometry';
import type { CircuitEnvData } from './types';

function sampleIdx(m: TrackModel, u: number): number {
  const uu = ((u % 1) + 1) % 1;
  return Math.floor(uu * m.n) % m.n;
}

/**
 * Shared 1-draw-call trackside sponsor builder:
 * barrier boards, braking distance markers, painted run-off ground decals,
 * start/finish gantry banner, overhead bridge fascias, pit-building roof fascia,
 * and grandstand front fascia mapped to a single WebP partner logo atlas.
 */
export function buildTrackAdsGeometry(
  m: TrackModel,
  lay: Layout,
  env: CircuitEnvData,
  opts: {
    titleBrand: string;
    gantryHeightM?: number;
    bridgeHeightM?: number;
    pitFasciaOffsetM?: number;
    pitFasciaY0M?: number;
    pitFasciaY1M?: number;
    standBrands?: string[];
  },
): THREE.BufferGeometry {
  const uvById = new Map<string, [number, number, number, number]>();
  for (const a of env.atlas) uvById.set(a.id, a.uv);
  const white = new THREE.Color('#ffffff');
  const g = new Mesher(true);
  const M = m.M;

  // 1. Trackside barrier boards, braking markers, and painted run-off decals
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

  // 2. Start gantry title sponsor banner (both faces)
  const titleUv = uvById.get(opts.titleBrand);
  if (titleUv) {
    const left = Math.min(lay.L.barrier[0], m.hwL[0] + 1.2 * M);
    const right = m.hwR[0] + 0.6 * M;
    const ph = (opts.gantryHeightM ?? 7.8) * M;
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
    g.quad(F(-1, -1, -1), F(1, -1, -1), F(-1, 1, -1), F(1, 1, -1), white, false, [titleUv[0], titleUv[2], titleUv[1], titleUv[3]]);
    g.quad(F(1, -1, 1), F(-1, -1, 1), F(1, 1, 1), F(-1, 1, 1), white, false, [titleUv[0], titleUv[2], titleUv[1], titleUv[3]]);
  }

  // 3. Overhead bridge / wing fascia banners (both faces)
  const brH = (opts.bridgeHeightM ?? 6.8) * M;
  for (const br of env.bridges) {
    const uv = uvById.get(br.brand);
    if (!uv) continue;
    const i = sampleIdx(m, br.u);
    const left = lay.L.barrier[i] + 0.8 * M;
    const right = lay.R.barrier[i] + 0.8 * M;
    const fx = m.tx[i];
    const fz = m.tz[i];
    const rx = m.rx[i];
    const rz = m.rz[i];
    const mid = at(m, i, (right - left) / 2, brH);
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

  // 4. Pit building roof fascia
  if (titleUv) {
    const core = Math.round(lay.pitN * 0.64);
    const pitBase = (i: number) => lay.pitCentre[i] + m.pit.width / 2 + 0.5 * M;
    const panels = 5;
    const offM = opts.pitFasciaOffsetM ?? -2.16;
    const y0 = (opts.pitFasciaY0M ?? 8.65) * M;
    const y1 = (opts.pitFasciaY1M ?? 9.85) * M;
    for (let k = 0; k < panels; k++) {
      const frac = -0.82 + (k + 0.5) * (1.64 / panels);
      const i = wrapIndex(Math.round(frac * core), m.n);
      const off = pitBase(i) + offM * M;
      const halfL = 4.2 * M;
      const c = at(m, i, off, 0);
      const tx = m.tx[i];
      const tz = m.tz[i];
      const P = (dl: number, y: number): V3 => [c[0] + tx * dl, c[1] + y, c[2] + tz * dl];
      g.quad(P(halfL, y0), P(-halfL, y0), P(halfL, y1), P(-halfL, y1), white, false, [titleUv[0], titleUv[2], titleUv[1], titleUv[3]]);
    }
  }

  // 5. Grandstand front fascia sponsor banners
  const standBrands = opts.standBrands ?? [
    opts.titleBrand,
    'pirelli',
    'aramco',
    'heineken',
    'tag_heuer',
    'dhl',
    'msc_cruises',
    'amex',
    'lenovo',
    'f1_2026',
  ];
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
