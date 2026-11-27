import { CLEAR_S, PIT_SPAN } from './dims';
import type { ScWindow } from './raceScene';

/**
 * Where the safety car wants to be (pure). The SC joins the traffic resolver as one more
 * car (never overlapping anyone, lapped cars included); this gives its TRUE position:
 *   - deploys from the pit exit as the leader starts the first SC lap, then closes up to
 *     a couple of car lengths ahead of the leader
 *   - lights out on the last SC lap; peels into the pit lane before the line and runs
 *     down it to the garages, where it disappears
 */
export const SC_FOLLOW_GAP = CLEAR_S * 2.3;
const JOIN_GAP_FRAC = PIT_SPAN * 0.8;
const PIT_IN_FRAC = 0.9;

export interface ScState {
  on: boolean;
  /** arc position (render units, 0..L) */
  s: number;
  /** in the pit lane (joining or leaving) */
  pit: boolean;
  lights: boolean;
  window: ScWindow | null;
}

export function createScState(): ScState {
  return { on: false, s: 0, pit: false, lights: false, window: null };
}

export function scState(windows: ScWindow[], t: number, leaderS: number, L: number, out: ScState): ScState {
  let w: ScWindow | null = null;
  for (const x of windows) if (t >= x.tStart && t < x.tEnd) w = x;
  out.window = w;
  out.on = false;
  if (!w || Number.isNaN(leaderS)) return out;
  const lapT = Math.max(20, w.tEnd - w.tLastLap);
  const since = t - w.tStart;
  const join = Math.min(1, since / Math.max(8, lapT * 0.35));
  const gap = SC_FOLLOW_GAP + (JOIN_GAP_FRAC * L - SC_FOLLOW_GAP) * (1 - join) * (1 - join);
  let s = leaderS + gap;
  const lastLap = t >= w.tLastLap;
  const tPitIn = w.tLastLap + Math.max(0, PIT_IN_FRAC - SC_FOLLOW_GAP / L) * lapT;
  let pit = false;
  if (lastLap && t >= tPitIn) {
    const dist = (t - tPitIn) * (L / lapT) * 0.55;
    if (dist > (1 - PIT_IN_FRAC + PIT_SPAN * 0.5) * L) return out; // in the garage
    s = PIT_IN_FRAC * L + dist;
    pit = true;
  }
  s = ((s % L) + L) % L;
  const f = s / L;
  // joining: still in the pit lane until its exit
  if (!pit && since < lapT * 0.5 && f < PIT_SPAN * 1.05) pit = true;
  out.on = true;
  out.s = s;
  out.pit = pit;
  out.lights = !lastLap;
  return out;
}
