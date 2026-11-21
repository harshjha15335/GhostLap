import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RaceBundle } from '@/types';

/** Test-only helpers: read the generated race bundles from public/data/2026/races. */
const DIR = join(process.cwd(), 'public', 'data', '2026', 'races');

export function raceSlugs(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

const cache = new Map<string, RaceBundle>();
export function loadBundle(slug: string): RaceBundle {
  let b = cache.get(slug);
  if (!b) {
    b = JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8')) as RaceBundle;
    cache.set(slug, b);
  }
  return b;
}
