import { create } from 'zustand';
import type { QualityMode } from './prefs';

/**
 * Adaptive render quality for the replay canvas.
 *
 * A single level q ∈ [0, 1]: High = 1, Low = 0, Auto = the drei PerformanceMonitor
 * factor (it steps down when the frame rate drops, back up when there is headroom).
 * Everything that costs GPU time keys off q:
 *   dpr          1 … 1.5 (Low: 1, or less on very high-density screens never above 1)
 *   airflow      share of ribbons / puffs drawn: 0.3 … 1
 *   car shadows  soft blob shadows under the cars (1 instanced draw call), q ≥ 0.25
 *   env shadows  shadow-mapped sun on barriers / structures, q ≥ 0.75
 *   environment  sky dome + trackside scatter (trees, buildings) hidden below q 0.25
 */
interface QualityState {
  /** Auto: the PerformanceMonitor factor (0..1) */
  factor: number;
  /** last measured fps (Auto), for the HUD tooltip */
  fps: number;
  setFactor: (factor: number, fps?: number) => void;
}

export const useReplayQuality = create<QualityState>((set) => ({
  factor: 0.7,
  fps: 0,
  setFactor: (factor, fps) => set((s) => ({ factor: Math.max(0, Math.min(1, factor)), fps: fps ?? s.fps })),
}));

export interface QualitySettings {
  q: number;
  dpr: number;
  airflowDensity: number;
  carShadows: boolean;
  envShadows: boolean;
  richEnvironment: boolean;
}

export function qualityLevel(mode: QualityMode, factor: number): number {
  return mode === 'high' ? 1 : mode === 'low' ? 0 : Math.round(factor * 10) / 10;
}

export function qualitySettings(q: number): QualitySettings {
  return {
    q,
    dpr: q <= 0 ? 1 : 1 + 0.5 * q,
    airflowDensity: 0.3 + 0.7 * q,
    carShadows: q >= 0.25,
    envShadows: q >= 0.75,
    richEnvironment: q >= 0.25,
  };
}
