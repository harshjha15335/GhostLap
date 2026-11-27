import { create } from 'zustand';

/**
 * Race Lab view preferences (replay-local; the integrator-owned raceLabStore stays untouched).
 * Remembered per browser when storage is available.
 */
interface ReplayPrefs {
  /** airflow / dirty-air visual (focus car + neighbours full, the rest lighter) */
  airflow: boolean;
  /** cut the camera to incidents and the safety car for a few seconds */
  autoCut: boolean;
  setAirflow: (on: boolean) => void;
  setAutoCut: (on: boolean) => void;
}

const KEY = 'ghostlap.replay.prefs';

function read(): Partial<Pick<ReplayPrefs, 'airflow' | 'autoCut'>> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function write(p: Pick<ReplayPrefs, 'airflow' | 'autoCut'>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

const initial = typeof window === 'undefined' ? {} : read();

export const useReplayPrefs = create<ReplayPrefs>((set, get) => ({
  airflow: initial.airflow ?? true,
  autoCut: initial.autoCut ?? true,
  setAirflow: (airflow) => {
    set({ airflow });
    write({ airflow, autoCut: get().autoCut });
  },
  setAutoCut: (autoCut) => {
    set({ autoCut });
    write({ airflow: get().airflow, autoCut });
  },
}));
