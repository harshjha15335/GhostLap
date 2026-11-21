import { useEffect, useState } from 'react';
import type { Group } from 'three';
import type { CarState, WhatIfScenario } from '@/types';
import type { LapProgress } from '@/engine/raceInterpolator';
import { useRaceLab } from '@/store/raceLabStore';
import { scenarioChangeLap } from './raceMath';

/** Render-space constants shared by the replay scene. */
export const TRACK_WIDTH = 3.4;
export const CAR_SCALE = 0.55;
export const PIT_LANE_OFFSET = TRACK_WIDTH / 2 + 1.35;
export const GHOST_LANE = -1.05;

/**
 * Mutable per-frame bus written by the scene's sampler (useFrame) and read by
 * other scene components. Never put React state in here.
 */
export const frame = {
  time: -1,
  states: [] as CarState[],
  byDriver: new Map<number, CarState>(),
  /** gap (s) of the car directly behind, keyed by the car being followed */
  gapBehind: new Map<number, number>(),
  ghost: null as LapProgress | null,
  carGroups: new Map<number, Group>(),
  ghostGroup: null as Group | null,
  /** 0..1 top-down camera weight (cars scale up so they read from above) */
  topW: 0,
  chase: false,
};

/** Re-render the calling component at ~hz (for DOM HUD that reads getState()). */
export function useTicker(hz: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => (n + 1) & 0xffff), 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
}

/**
 * Run a scenario and stage the replay so the ghost-vs-reality battle is on screen:
 * focus the driver, seek a few laps before the first change, play.
 */
export function launchScenario(sc: WhatIfScenario, opts: { openDrawer?: boolean } = {}) {
  const s = useRaceLab.getState();
  if (!s.bundle) return null;
  const res = s.runScenario(sc);
  const change = scenarioChangeLap(s.bundle, sc);
  s.setFocusDriver(sc.driverNumber);
  s.seekLap(Math.max(1, change - 3));
  if (s.speed > 10) s.setSpeed(10);
  if (s.camera === 'topdown') s.setCamera('broadcast');
  if (opts.openDrawer) s.setDrawerOpen(true);
  s.play();
  return res;
}
