import type { GhostResult, RaceBundle, WhatIfPreset, WhatIfScenario } from '@/types';

/**
 * Deterministic "What If?" Ghost Car solver.
 *
 *   LapTime_ghost(L) = BasePace_D(L) + Δtyre(compound, age) + Δfuel(L)
 *                      + ΔdirtyAir(gap_ahead) + Δpit(L) + ΔSC(L)
 *
 * PHASE 0 STUB — Agent 1 implements the full model, presets and tests.
 * The stub returns the driver's real race so the UI can be built against it.
 */
export const MODEL = {
  fuelSecondsPerLap: 0.03,
  dirtyAirMaxPenalty: 0.3,
  dirtyAirFullGap: 1.0,
  dirtyAirZeroGap: 2.0,
  safetyCarPitDiscount: 0.4,
  minPitDelta: -8,
  maxPitDelta: 12,
} as const;

export function defaultScenario(bundle: RaceBundle, driverNumber: number, fromLap: number): WhatIfScenario {
  const car = bundle.cars.find((c) => c.driverNumber === driverNumber) ?? bundle.cars[0];
  const stops = car.pits
    .filter((p) => p.lap >= fromLap)
    .map((p) => {
      const next = car.stints.find((s) => s.lapStart === p.lap + 1);
      return { lap: p.lap, compound: next?.compound ?? 'HARD' };
    });
  return { driverNumber: car.driverNumber, fromLap, stops, avoidPenalties: false };
}

export function simulateGhost(bundle: RaceBundle, scenario: WhatIfScenario): GhostResult {
  const car = bundle.cars.find((c) => c.driverNumber === scenario.driverNumber) ?? bundle.cars[0];
  const laps = [...car.laps];
  const cumulative: number[] = [];
  let acc = 0;
  for (const t of laps) cumulative.push((acc += t));
  const pos = car.finishPosition ?? bundle.cars.length;
  return {
    scenario,
    laps,
    cumulative,
    totalTime: acc,
    realTotalTime: acc,
    deltaSeconds: 0,
    realFinishPosition: car.finishPosition,
    ghostFinishPosition: pos,
    positionsGained: 0,
    positionByLap: laps.map(() => pos),
    overtakes: [],
    verdict: 'No change from the real race.',
  };
}

export function computePresets(bundle: RaceBundle): WhatIfPreset[] {
  void bundle;
  return [];
}
