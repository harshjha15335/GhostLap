import { useEffect } from 'react';
import { create } from 'zustand';
import type { Driver, SeasonData, Team } from '@/types';
import { loadSeason } from '@/engine/dataLoader';

interface SeasonState {
  season: SeasonData | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  driversByNumber: Map<number, Driver>;
  teamsById: Map<string, Team>;
  load: () => Promise<void>;
}

export const useSeasonStore = create<SeasonState>((set, get) => ({
  season: null,
  status: 'idle',
  driversByNumber: new Map(),
  teamsById: new Map(),
  async load() {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    try {
      const season = await loadSeason();
      set({
        season,
        status: 'ready',
        driversByNumber: new Map(season.drivers.map((d) => [d.number, d])),
        teamsById: new Map(season.teams.map((t) => [t.id, t])),
      });
    } catch {
      set({ status: 'error' });
    }
  },
}));

/** Loads season data on first use and returns it (null while loading). */
export function useSeason(): SeasonData | null {
  const season = useSeasonStore((s) => s.season);
  const load = useSeasonStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return season;
}

/** Driver lookup helpers that are safe before data loads. */
export function useDriverLookup() {
  useSeason();
  const drivers = useSeasonStore((s) => s.driversByNumber);
  const teams = useSeasonStore((s) => s.teamsById);
  return {
    driver: (n: number) => drivers.get(n),
    team: (id: string) => teams.get(id),
    color: (n: number) => drivers.get(n)?.color ?? '#888888',
    code: (n: number) => drivers.get(n)?.code ?? String(n),
  };
}
