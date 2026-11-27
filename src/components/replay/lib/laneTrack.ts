import type { TrackModel } from '@/components/track/trackModel';
import { CAR_WID, KERB_ALLOW } from './dims';

/**
 * Per-circuit lateral data for the replay, sampled at the track model's arc-length
 * stations (sample i sits at lap fraction i / n):
 *   line   racing line: lateral offset (render units, + = right of the racing direction)
 *   lo/hi  where a car's centre may be (asphalt edge − half a car + kerb allowance)
 *   kappa  signed curvature (+ = right-hander)
 */
export interface LaneTrack {
  n: number;
  length: number;
  ds: number;
  line: Float32Array;
  lo: Float32Array;
  hi: Float32Array;
  kappa: Float32Array;
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** max lateral change of the racing line per unit of track (≈ 13°) */
export const LINE_SLOPE = 0.22;

/** Linear interpolation of a per-sample array at arc position s (wraps). */
export function sampleLane(arr: Float32Array, lt: LaneTrack, s: number): number {
  const f = s / lt.ds;
  const i0 = Math.floor(f);
  const k = f - i0;
  const a = arr[wrap(i0, lt.n)];
  const b = arr[wrap(i0 + 1, lt.n)];
  return a + (b - a) * k;
}

/**
 * "Optimal-ish" racing line by an elastic band: the path P_i = C_i + d_i·r_i is relaxed
 * towards the midpoint of its neighbours k samples away (coarse → fine), clamped to the
 * usable width. A taut band through the corridor runs outside on entry, clips the inside
 * at the apex and drifts back out on exit, which is what a minimum-curvature line does
 * at the scale we draw. Runs once per circuit (~1–3 ms).
 */
export function computeRacingLine(m: TrackModel, lo: Float32Array, hi: Float32Array, margin: number): Float32Array {
  const n = m.n;
  const d = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = lo[i] + margin;
    b[i] = hi[i] - margin;
    if (a[i] > b[i]) a[i] = b[i] = (lo[i] + hi[i]) / 2;
  }
  const spans = [48, 32, 20, 12, 7, 4].map((sp) => Math.max(2, Math.round((sp * 0.55) / m.ds)));
  for (const k of spans) {
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < n; i++) {
        const ia = wrap(i - k, n);
        const ib = wrap(i + k, n);
        const mx = (m.px[ia] + m.rx[ia] * d[ia] + m.px[ib] + m.rx[ib] * d[ib]) / 2;
        const mz = (m.pz[ia] + m.rz[ia] * d[ia] + m.pz[ib] + m.rz[ib] * d[ib]) / 2;
        const delta = (mx - (m.px[i] + m.rx[i] * d[i])) * m.rx[i] + (mz - (m.pz[i] + m.rz[i] * d[i])) * m.rz[i];
        let v = d[i] + 0.6 * delta;
        if (v < a[i]) v = a[i];
        else if (v > b[i]) v = b[i];
        d[i] = v;
      }
    }
  }
  // light smoothing (± ~2 m) so the line has no kinks where it touches the limits
  const out = new Float32Array(n);
  const w = Math.max(1, Math.round(1.1 / m.ds));
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -w; j <= w; j++) acc += d[wrap(i + j, n)];
    out[i] = Math.min(b[i], Math.max(a[i], acc / (2 * w + 1)));
  }
  // limit the line's lateral slope so cars (rate-limited in traffic.ts) can follow it exactly
  const c = LINE_SLOPE * m.ds;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i <= n; i++) {
      const p = out[wrap(i - 1, n)];
      const k = wrap(i, n);
      out[k] = Math.min(p + c, Math.max(p - c, out[k]));
    }
    for (let i = n - 2; i >= -1; i--) {
      const p = out[wrap(i + 1, n)];
      const k = wrap(i, n);
      out[k] = Math.min(p + c, Math.max(p - c, out[k]));
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(b[i], Math.max(a[i], out[i]));
  return out;
}

export function buildLaneTrack(m: TrackModel): LaneTrack {
  const n = m.n;
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lo[i] = -m.hwL[i] + CAR_WID / 2 - KERB_ALLOW;
    hi[i] = m.hwR[i] - CAR_WID / 2 + KERB_ALLOW;
  }
  const line = computeRacingLine(m, lo, hi, KERB_ALLOW + 0.08);
  return { n, length: m.length, ds: m.ds, line, lo, hi, kappa: m.kappa };
}
