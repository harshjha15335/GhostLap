import { create } from 'zustand';

/**
 * Race Lab view preferences (replay-local; the integrator-owned raceLabStore stays untouched).
 * Remembered per browser when storage is available.
 */
export type QualityMode = 'auto' | 'high' | 'low';

interface ReplayPrefs {
  /** airflow / dirty-air visual (focus car + neighbours full, the rest lighter) */
  airflow: boolean;
  /** cut the camera to incidents and the safety car for a few seconds */
  autoCut: boolean;
  /** render quality: Auto adapts to the frame rate (lib/quality.ts) */
  quality: QualityMode;
  setAirflow: (on: boolean) => void;
  setAutoCut: (on: boolean) => void;
  setQuality: (q: QualityMode) => void;
}

const KEY = 'ghostlap.replay.prefs';
type Stored = Pick<ReplayPrefs, 'airflow' | 'autoCut' | 'quality'>;

function read(): Partial<Stored> {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function write(p: Stored) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

const initial = typeof window === 'undefined' ? {} : read();
const QUALITIES: QualityMode[] = ['auto', 'high', 'low'];

export const useReplayPrefs = create<ReplayPrefs>((set, get) => ({
  airflow: initial.airflow ?? true,
  autoCut: initial.autoCut ?? true,
  quality: QUALITIES.includes(initial.quality as QualityMode) ? (initial.quality as QualityMode) : 'auto',
  setAirflow: (airflow) => {
    set({ airflow });
    write({ ...pick(get()), airflow });
  },
  setAutoCut: (autoCut) => {
    set({ autoCut });
    write({ ...pick(get()), autoCut });
  },
  setQuality: (quality) => {
    set({ quality });
    write({ ...pick(get()), quality });
  },
}));

function pick(s: ReplayPrefs): Stored {
  return { airflow: s.airflow, autoCut: s.autoCut, quality: s.quality };
}
