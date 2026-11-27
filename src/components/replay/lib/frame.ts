import { useEffect, useState } from 'react';
import type { Group, Object3D, Vector3 } from 'three';
import type { CarState, TrackStatusType, WhatIfScenario } from '@/types';
import type { LapProgress } from '@/engine/raceInterpolator';
import { useRaceLab } from '@/store/raceLabStore';
import { scenarioChangeLap } from './raceMath';

export { TRACK_WIDTH, CAR_SCALE, PIT_LANE_OFFSET, GHOST_LANE } from './dims';

/** Max cars the per-car GPU arrays are sized for (airflow shader uniforms). */
export const MAX_CARS = 24;

/** Per-car airflow inputs written by Cars.tsx each frame, read by Airflow.tsx. */
export interface AirflowBus {
  /** world position (x, y, z) */
  pos: Float32Array;
  /** world heading angle about +Y (rotation.y of the car) */
  yaw: Float32Array;
  /** 0..1 speed relative to a typical racing speed */
  speed: Float32Array;
  /** path curvature (dyaw / ds, rad per render unit) */
  curv: Float32Array;
  /** dirty-air downforce loss of the car directly behind (0..1, strategySimulator.downforceLoss) */
  loss: Float32Array;
  /** distance (render units) to that follower's nose, 0 = none */
  follow: Float32Array;
  /** 0..1 how strongly to draw this car's airflow (focus + neighbours 1, rest lighter) */
  weight: Float32Array;
  /** car scale factor (top-down zoom) */
  scale: number;
  count: number;
}

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
  /** track status at `time` (SC / VSC / RED) */
  status: null as TrackStatusType | null,
  carGroups: new Map<number, Group>(),
  /** racing direction at each car (track tangent: steady even while a car spins) */
  carDir: new Map<number, Vector3>(),
  /** drivers currently side by side with someone */
  battling: new Set<number>(),
  /** safety car group while it is on track */
  safetyCar: null as Object3D | null,
  /** director cue: something worth cutting to (incident / SC), with its expiry (performance.now ms) */
  cue: null as { target: Object3D; until: number; label: string } | null,
  air: {
    pos: new Float32Array(MAX_CARS * 3),
    yaw: new Float32Array(MAX_CARS),
    speed: new Float32Array(MAX_CARS),
    curv: new Float32Array(MAX_CARS),
    loss: new Float32Array(MAX_CARS),
    follow: new Float32Array(MAX_CARS),
    weight: new Float32Array(MAX_CARS),
    scale: 1,
    count: 0,
  } as AirflowBus,
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
