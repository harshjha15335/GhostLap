/**
 * Driver portrait / helmet media. `media.generated.json` is written by
 * scripts/drivers/process_driver_media.py and lists, per driver code, which processed
 * images exist and where the head sits in the portrait. A driver with no entry renders the
 * clearly-labelled placeholder card; nothing is ever invented.
 */

export interface MediaImage {
  /** pixel size of the largest variant */
  w: number;
  h: number;
  /** available heights in px (each written as <kind>-<h>.webp) */
  sizes: number[];
}

/** where the reveal centres when it is opened without a pointer (keyboard / reduced motion) */
export interface HeadAlign {
  /** head centre, 0..1 of the portrait frame */
  cx: number;
  cy: number;
  /** head radius as a fraction of the frame height */
  r: number;
}

export interface DriverMedia {
  portrait: MediaImage | null;
  helmet: MediaImage | null;
  align: HeadAlign | null;
}

export interface MediaManifest {
  drivers: Record<string, DriverMedia>;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseImage(v: unknown): MediaImage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!num(o.w) || !num(o.h) || !Array.isArray(o.sizes)) return null;
  const sizes = o.sizes.filter(num).sort((a, b) => a - b);
  return sizes.length ? { w: o.w, h: o.h, sizes } : null;
}

function parseAlign(v: unknown): HeadAlign | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return num(o.cx) && num(o.cy) && num(o.r) ? { cx: o.cx, cy: o.cy, r: o.r } : null;
}

export function parseManifest(raw: unknown): MediaManifest {
  const drivers: Record<string, DriverMedia> = {};
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).drivers : null;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [code, v] of Object.entries(src as Record<string, unknown>)) {
      const o = (v ?? {}) as Record<string, unknown>;
      drivers[code.toUpperCase()] = { portrait: parseImage(o.portrait), helmet: parseImage(o.helmet), align: parseAlign(o.align) };
    }
  }
  return { drivers };
}

const EMPTY: DriverMedia = { portrait: null, helmet: null, align: null };
export const mediaFor = (m: MediaManifest, code: string): DriverMedia => m.drivers[code.toUpperCase()] ?? EMPTY;

/** URL of a processed image (served from public/, so it respects the deploy sub-path). */
export const mediaUrl = (code: string, kind: 'portrait' | 'helmet', h: number) =>
  `${import.meta.env.BASE_URL}drivers/${code.toLowerCase()}/${kind}-${h}.webp`;

/** srcset with width descriptors (the variants share one aspect ratio). */
export function mediaSrcSet(code: string, kind: 'portrait' | 'helmet', img: MediaImage): string {
  return img.sizes.map((h) => `${mediaUrl(code, kind, h)} ${Math.round((img.w * h) / img.h)}w`).join(', ');
}

// Written by scripts/drivers/process_driver_media.py next to this file and gitignored, like
// the images it describes. Without it (fresh clone) the glob is empty and every card shows
// its labelled stand-in; no request is made, so nothing 404s.
const generated = import.meta.glob<{ default: unknown }>('./media.generated.json', { eager: true });
const manifest = parseManifest(Object.values(generated)[0]?.default ?? null);

/** The processed-media manifest (bundled at build time). */
export function loadManifest(): Promise<MediaManifest> {
  return Promise.resolve(manifest);
}
