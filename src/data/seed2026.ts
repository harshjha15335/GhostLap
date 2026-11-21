import type { RaceBundle, SeasonData } from '@/types';
import { SEED_RACE_SLUGS } from '@/types';

/**
 * Embedded fallback data (Phase 0 starter — Agent 1 owns and may refine).
 * The JSON files in ./seed are written by scripts/fetch_2026_season.py and are
 * code-split, so they only download when the static /data bundle is unreachable.
 */
const seedRaces: Record<string, () => Promise<{ default: unknown }>> = {
  melbourne: () => import('./seed/melbourne.json'),
  silverstone: () => import('./seed/silverstone.json'),
  monza: () => import('./seed/monza.json'),
};

export const SEED_SLUGS: readonly string[] = SEED_RACE_SLUGS;

export async function loadSeedSeason(): Promise<SeasonData> {
  const mod = await import('./seed/season.json');
  return mod.default as unknown as SeasonData;
}

export async function loadSeedRace(slug: string): Promise<RaceBundle | null> {
  const loader = seedRaces[slug];
  if (!loader) return null;
  const mod = await loader();
  return mod.default as RaceBundle;
}
