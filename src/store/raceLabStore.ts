import { create } from 'zustand';
import type { CameraMode, GhostResult, RaceBundle, WhatIfScenario } from '@/types';
import { loadRace } from '@/engine/dataLoader';
import { createRaceTimeline, type RaceTimeline } from '@/engine/raceInterpolator';
import { simulateGhost } from '@/engine/strategySimulator';

/**
 * Race Lab state (replay + What-If). Owned by the integrator.
 * Per-frame consumers should read via useRaceLab.getState() inside useFrame
 * instead of subscribing, to avoid 60fps React re-renders.
 */
export interface RaceLabState {
  slug: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  bundle: RaceBundle | null;
  timeline: RaceTimeline | null;

  /** race clock in seconds since lights out */
  time: number;
  playing: boolean;
  /** playback multiplier */
  speed: number;
  camera: CameraMode;
  /** driver the camera / HUD follows */
  focusDriver: number | null;

  drawerOpen: boolean;
  scenario: WhatIfScenario | null;
  ghost: GhostResult | null;

  loadRace: (slug: string, opts?: { autoplay?: boolean }) => Promise<void>;
  setTime: (t: number) => void;
  seekLap: (lap: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
  setCamera: (c: CameraMode) => void;
  setFocusDriver: (dn: number | null) => void;
  setDrawerOpen: (open: boolean) => void;
  /** set scenario and synchronously recompute the ghost (deterministic) */
  runScenario: (s: WhatIfScenario) => GhostResult | null;
  clearGhost: () => void;
}

export const PLAYBACK_SPEEDS = [1, 2, 5, 10, 20, 40] as const;

export const useRaceLab = create<RaceLabState>((set, get) => ({
  slug: null,
  status: 'idle',
  error: null,
  bundle: null,
  timeline: null,
  time: 0,
  playing: false,
  speed: 10,
  camera: 'broadcast',
  focusDriver: null,
  drawerOpen: false,
  scenario: null,
  ghost: null,

  async loadRace(slug, opts) {
    if (get().slug === slug && get().status === 'ready') {
      if (opts?.autoplay) set({ playing: true });
      return;
    }
    set({ slug, status: 'loading', error: null, ghost: null, scenario: null, playing: false, time: 0 });
    try {
      const bundle = await loadRace(slug);
      if (get().slug !== slug) return; // superseded
      const timeline = createRaceTimeline(bundle);
      const winner = bundle.cars.find((c) => c.finishPosition === 1) ?? bundle.cars[0];
      set({
        bundle,
        timeline,
        status: 'ready',
        focusDriver: winner?.driverNumber ?? null,
        time: timeline.timeAtLap(1) + 1,
        playing: !!opts?.autoplay,
      });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  setTime: (t) => {
    const tl = get().timeline;
    const clamped = Math.max(0, Math.min(t, tl?.duration ?? t));
    set({ time: clamped, playing: tl && clamped >= tl.duration ? false : get().playing });
  },
  seekLap: (lap) => {
    const tl = get().timeline;
    if (tl) set({ time: tl.timeAtLap(lap) });
  },
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set({ playing: !get().playing }),
  setSpeed: (speed) => set({ speed }),
  setCamera: (camera) => set({ camera }),
  setFocusDriver: (focusDriver) => set({ focusDriver }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  runScenario: (scenario) => {
    const bundle = get().bundle;
    if (!bundle) return null;
    const ghost = simulateGhost(bundle, scenario);
    set({ scenario, ghost });
    return ghost;
  },
  clearGhost: () => set({ scenario: null, ghost: null }),
}));
