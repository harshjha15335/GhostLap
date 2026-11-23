import type { Quality } from '../../trackModel';
import type { AlbertParkEnvData } from './types';

const cache = new Map<Quality, Promise<AlbertParkEnvData>>();

function basePrefix(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function melbourneAdsUrl(quality: Quality): string {
  const file = quality === 'low' ? 'ads_low.webp' : 'ads.webp';
  return `${basePrefix()}models/circuits/melbourne/${file}`;
}

export function loadMelbourneEnv(quality: Quality): Promise<AlbertParkEnvData> {
  const hit = cache.get(quality);
  if (hit) return hit;
  const file = quality === 'low' ? 'albert_park_env_low.json' : 'albert_park_env.json';
  const url = `${basePrefix()}models/circuits/melbourne/${file}`;
  const promise = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return res.json() as Promise<AlbertParkEnvData>;
  });
  cache.set(quality, promise);
  return promise;
}
