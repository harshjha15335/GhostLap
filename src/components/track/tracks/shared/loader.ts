import type { Quality } from '../../trackModel';
import type { CircuitEnvData } from './types';

const envCache = new Map<string, Promise<CircuitEnvData>>();

function basePrefix(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function circuitAssetUrl(slug: string, filename: string): string {
  return `${basePrefix()}models/circuits/${slug}/${filename}`;
}

export function circuitAdsUrl(slug: string, quality: Quality): string {
  return circuitAssetUrl(slug, quality === 'low' ? 'ads_low.webp' : 'ads.webp');
}

export function circuitFacadesUrl(slug: string, quality: Quality): string {
  return circuitAssetUrl(slug, quality === 'low' ? 'facades_low.webp' : 'facades.webp');
}

export function loadCircuitEnv(slug: string, filePrefix: string, quality: Quality): Promise<CircuitEnvData> {
  const file = quality === 'low' ? `${filePrefix}_low.json` : `${filePrefix}.json`;
  const key = `${slug}:${file}`;
  const hit = envCache.get(key);
  if (hit) return hit;
  const url = circuitAssetUrl(slug, file);
  const promise = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return res.json() as Promise<CircuitEnvData>;
  });
  envCache.set(key, promise);
  return promise;
}
