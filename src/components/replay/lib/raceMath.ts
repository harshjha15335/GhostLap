import type { Compound, RaceBundle, WhatIfScenario } from '@/types';
import { MODEL, defaultScenario } from '@/engine/strategySimulator';

/** Seconds/lap lost to dirty air at a given gap to the car ahead (MODEL constants). */
export function dirtyAirPenalty(gapAhead: number): number {
  if (!Number.isFinite(gapAhead)) return 0;
  if (gapAhead <= MODEL.dirtyAirFullGap) return MODEL.dirtyAirMaxPenalty;
  if (gapAhead >= MODEL.dirtyAirZeroGap) return 0;
  const k = (MODEL.dirtyAirZeroGap - gapAhead) / (MODEL.dirtyAirZeroGap - MODEL.dirtyAirFullGap);
  return MODEL.dirtyAirMaxPenalty * k;
}

/** 0..1 wake intensity for a car with a follower `gapBehind` seconds back. */
export function wakeIntensity(gapBehind: number): number {
  return dirtyAirPenalty(gapBehind) / MODEL.dirtyAirMaxPenalty;
}

/** Downforce available (percent) – drains up to 35 % in full dirty air. */
export function downforcePct(gapAhead: number): number {
  return 100 - 35 * wakeIntensity(gapAhead);
}

const TYRE_LIFE: Record<Compound, number> = { SOFT: 20, MEDIUM: 30, HARD: 42, INTERMEDIATE: 28, WET: 34 };

/** 0 (fresh) .. 1 (cooked) */
export function tyreWear(compound: Compound, age: number): number {
  return Math.max(0, Math.min(1, age / TYRE_LIFE[compound]));
}

export const COMPOUND_SHORT: Record<Compound, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

/** Linear time at which a lap-time series reaches `progress` lap units. */
export function timeAtProgress(cum: number[], progress: number): number {
  if (!cum.length) return 0;
  const i = Math.floor(progress);
  if (i >= cum.length) return cum[cum.length - 1];
  const start = i === 0 ? 0 : cum[i - 1];
  return start + (cum[i] - start) * (progress - i);
}

/** Real pit-stop laps at/after `fromLap` for a driver (what the scenario editor starts from). */
export function realStopsFrom(bundle: RaceBundle, driverNumber: number, fromLap: number) {
  return defaultScenario(bundle, driverNumber, fromLap).stops;
}

/** First lap where the scenario departs from reality (used to seek before the change). */
export function scenarioChangeLap(bundle: RaceBundle, sc: WhatIfScenario): number {
  const real = realStopsFrom(bundle, sc.driverNumber, sc.fromLap);
  const n = Math.max(real.length, sc.stops.length);
  const sorted = [...sc.stops].sort((a, b) => a.lap - b.lap);
  for (let i = 0; i < n; i++) {
    const r = real[i];
    const g = sorted[i];
    if (!r || !g || r.lap !== g.lap || r.compound !== g.compound) {
      return Math.max(sc.fromLap, Math.min(r?.lap ?? Infinity, g?.lap ?? Infinity));
    }
  }
  return sc.fromLap;
}

export function fmtGap(s: number): string {
  if (!Number.isFinite(s)) return '';
  return `+${s.toFixed(s >= 100 ? 1 : 3)}`;
}

export function fmtRaceClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function fmtDelta(s: number): string {
  const sign = s < 0 ? '−' : s > 0 ? '+' : '±';
  return `${sign}${Math.abs(s).toFixed(2)}s`;
}
