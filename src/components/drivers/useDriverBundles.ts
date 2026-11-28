import { useEffect, useState } from 'react';
import type { RaceBundle } from '@/types';
import { loadRace } from '@/engine/dataLoader';

export const MAX_PARALLEL = 4;

export interface BundleProgress {
  bundles: Record<string, RaceBundle>;
  /** bundles settled so far (loaded or failed) */
  settled: number;
  failed: string[];
  total: number;
  done: boolean;
}

/**
 * Loads race bundles lazily, at most MAX_PARALLEL requests in flight, through the shared
 * loadRace() cache (so revisiting a driver, or a replay, reuses them). Reports progress.
 */
export function useDriverBundles(slugs: string[]): BundleProgress {
  const key = slugs.join(',');
  const [state, setState] = useState<BundleProgress>({ bundles: {}, settled: 0, failed: [], total: slugs.length, done: slugs.length === 0 });

  useEffect(() => {
    const list = key ? key.split(',') : [];
    let alive = true;
    setState({ bundles: {}, settled: 0, failed: [], total: list.length, done: list.length === 0 });
    const queue = [...list];
    let active = 0;
    const pump = () => {
      while (alive && active < MAX_PARALLEL && queue.length) {
        const slug = queue.shift()!;
        active++;
        loadRace(slug)
          .then((b) => alive && setState((s) => ({ ...s, bundles: { ...s.bundles, [slug]: b }, settled: s.settled + 1, done: s.settled + 1 >= s.total })))
          .catch(() => alive && setState((s) => ({ ...s, failed: [...s.failed, slug], settled: s.settled + 1, done: s.settled + 1 >= s.total })))
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    pump();
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}
