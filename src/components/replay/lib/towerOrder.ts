import type { CarState } from '@/types';
import { isOut, planInPit, planProgress, type RetirePlan } from './incidents';

/**
 * HUD running order that agrees with what the scene shows (visual only — the timeline's
 * classification is unchanged):
 *   - a car whose timeline has it retired (its last completed lap ended) but which is
 *     still driving to its real stop point stays in the running order, at its visual
 *     progress, until it comes to rest (gaps unknown → NaN)
 *   - a car that came to rest before its last lap officially ended is shown out already
 * Positions of the running rows are renumbered 1..n accordingly. Returns new objects.
 */
export function towerOrder(
  states: CarState[],
  plans: (RetirePlan | null)[],
  idxByDriver: Map<number, number>,
  t: number,
  L: number,
): CarState[] {
  const running: CarState[] = [];
  const late: CarState[] = [];
  const out: CarState[] = [];
  for (const s of states) {
    const i = idxByDriver.get(s.driverNumber);
    const p = i === undefined ? null : plans[i];
    if (isOut(p, t, s.retired)) out.push(s.retired ? { ...s } : { ...s, retired: true, inPit: false, gapAhead: Infinity, gapToLeader: 0 });
    else if (s.retired && p) late.push({ ...s, retired: false, progress: planProgress(p, t, L), gapAhead: NaN, gapToLeader: NaN, inPit: planInPit(p, t, L) });
    else running.push({ ...s });
  }
  for (const s of late) {
    let k = running.findIndex((r) => !r.finished && r.progress < s.progress);
    if (k < 0) k = running.length;
    running.splice(k, 0, s);
  }
  running.forEach((s, k) => (s.position = k + 1));
  out.forEach((s, k) => (s.position = running.length + k + 1));
  return running.concat(out);
}
