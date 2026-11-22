import * as THREE from 'three';

/**
 * Team liveries for the procedural F1Car and DriverFigure.
 *
 * Colours approximate each team's 2026 livery layout (no sponsor logos are bundled).
 * Every car body is ONE MeshStandardMaterial whose `map` is a livery atlas texture:
 *   - without a `liveryTexture`, F1Car paints the base colours into the atlas at runtime
 *     with `paintLiveryCanvas` (cached per livery, so instances share one texture);
 *   - with a `liveryTexture` (e.g. a baked 1024×512 WebP with sponsor logos), that texture
 *     is used as-is (colour = texture × white).
 * Zones are therefore texture regions: no extra meshes, materials or draw calls.
 *
 * Patterns painted onto the body regions:
 *   solid   primary everywhere
 *   split   primary upper body, secondary lower flanks / sidepod undercut + nose tip
 *   stripe  primary body, secondary centre stripe along the nose/engine-cover top,
 *           accent pinstripes beside it
 *   fade    primary at the nose fading to secondary at the rear
 * Front & rear wing top surfaces and the halo take `accent`; front endplates `secondary`.
 */
export type LiveryPattern = 'solid' | 'split' | 'stripe' | 'fade';

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  pattern?: LiveryPattern;
}

export const LIVERIES: Record<string, Livery> = {
  mercedes: { primary: '#C6CBD0', secondary: '#0E0F11', accent: '#00D7B6', pattern: 'fade' },
  ferrari: { primary: '#DC0000', secondary: '#121212', accent: '#F4F4F4', pattern: 'split' },
  'red-bull-racing': { primary: '#1B2552', secondary: '#D7192C', accent: '#FFC906', pattern: 'stripe' },
  mclaren: { primary: '#FF8000', secondary: '#1B1D21', accent: '#FF8000', pattern: 'split' },
  'racing-bulls': { primary: '#F2F4F7', secondary: '#1634CB', accent: '#E8002D', pattern: 'split' },
  alpine: { primary: '#0A67C9', secondary: '#FF5BC8', accent: '#0B0D12', pattern: 'fade' },
  'haas-f1-team': { primary: '#F1F2F3', secondary: '#25272B', accent: '#E6002B', pattern: 'split' },
  audi: { primary: '#A5AAAF', secondary: '#121314', accent: '#F50537', pattern: 'split' },
  williams: { primary: '#1868DB', secondary: '#051C3F', accent: '#F2F4F7', pattern: 'fade' },
  'aston-martin': { primary: '#00594F', secondary: '#CEDC00', accent: '#CEDC00', pattern: 'stripe' },
  cadillac: { primary: '#121314', secondary: '#F2F2F2', accent: '#B9BEC4', pattern: 'split' },
};

/** Resolve a livery from a Livery object or teamId, falling back to plain colours. */
export function resolveLivery(livery: Livery | string | undefined, color: string, accent: string): Required<Livery> {
  const l = typeof livery === 'string' ? LIVERIES[livery] : livery;
  if (!l) return { primary: color, secondary: color, accent, pattern: 'solid' };
  return { primary: l.primary, secondary: l.secondary, accent: l.accent, pattern: l.pattern ?? 'solid' };
}

/* ------------------------------------------------------------------ */
/* Atlas layout                                                        */
/* ------------------------------------------------------------------ */

export type AtlasRegionId =
  | 'bodySideR'
  | 'bodySideL'
  | 'noseTop'
  | 'frontWing'
  | 'frontEndplateR'
  | 'frontEndplateL'
  | 'sidepodR'
  | 'sidepodL'
  | 'sidepodTopR'
  | 'sidepodTopL'
  | 'rearWing'
  | 'rearEndplateR'
  | 'rearEndplateL'
  | 'halo'
  | 'underside';

type Axis = 'x' | 'y' | 'z';
export interface AtlasRegion {
  /** [x, y, w, h] in normalised canvas coordinates: origin TOP-LEFT, x right, y down (0..1) */
  rect: [number, number, number, number];
  /** car-space axis mapped across the rect: value `from` at the left edge → `to` at the right edge */
  u: { axis: Axis; from: number; to: number };
  /** car-space axis mapped down the rect: value `from` at the top edge → `to` at the bottom edge */
  v: { axis: Axis; from: number; to: number };
  /** what is painted there by default */
  role: 'body' | 'accent' | 'secondary' | 'carbon';
  description: string;
}

/**
 * UV atlas used by every F1Car body surface. Designed for a 1024×512 texture (2:1; 512×256
 * also works). Rect aspect ratios roughly match the world size of each surface, so logos
 * drawn undistorted into a rect appear undistorted on the car. Side regions are oriented so
 * text reads correctly when seen from that side; top regions read with the nose to the left
 * (noseTop) or seen from behind the car (wings). Textures must use three's default
 * `flipY = true` (TextureLoader / CanvasTexture) and `colorSpace = SRGBColorSpace`.
 */
const px = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x / 1024, y / 512, w / 1024, h / 512];
export const LIVERY_ATLAS: { width: number; height: number; regions: Record<AtlasRegionId, AtlasRegion> } = {
  width: 1024,
  height: 512,
  regions: {
    bodySideR: { rect: px(0, 0, 508, 112), u: { axis: 'z', from: 2.9, to: -2.1 }, v: { axis: 'y', from: 1.08, to: 0.05 }, role: 'body', description: 'Right flank of nose, monocoque, airbox & engine cover (seen from the right: nose at left)' },
    bodySideL: { rect: px(516, 0, 508, 112), u: { axis: 'z', from: -2.1, to: 2.9 }, v: { axis: 'y', from: 1.08, to: 0.05 }, role: 'body', description: 'Left flank of nose, monocoque, airbox & engine cover (seen from the left: nose at right)' },
    noseTop: { rect: px(0, 116, 512, 72), u: { axis: 'z', from: 2.9, to: -2.1 }, v: { axis: 'x', from: 0.34, to: -0.34 }, role: 'body', description: 'Top of nose, cockpit surround, airbox & engine cover (nose at left, car left side at top)' },
    frontWing: { rect: px(512, 116, 384, 116), u: { axis: 'x', from: 0.96, to: -0.96 }, v: { axis: 'z', from: 2.94, to: 2.34 }, role: 'accent', description: 'Front wing upper surfaces (mainplane + flaps), seen from above/behind' },
    halo: { rect: px(904, 116, 48, 48), u: { axis: 'x', from: 0.3, to: -0.3 }, v: { axis: 'z', from: 0.95, to: -0.2 }, role: 'accent', description: 'Halo (sampled at the rect centre: flat colour)' },
    underside: { rect: px(960, 116, 48, 48), u: { axis: 'x', from: 1, to: -1 }, v: { axis: 'z', from: 3, to: -3 }, role: 'carbon', description: 'Downward-facing body surfaces (flat colour)' },
    sidepodR: { rect: px(0, 236, 256, 64), u: { axis: 'z', from: 0.66, to: -1.6 }, v: { axis: 'y', from: 0.62, to: 0.08 }, role: 'body', description: 'Right sidepod flank (seen from the right: front at left)' },
    sidepodL: { rect: px(260, 236, 256, 64), u: { axis: 'z', from: -1.6, to: 0.66 }, v: { axis: 'y', from: 0.62, to: 0.08 }, role: 'body', description: 'Left sidepod flank (seen from the left: front at right)' },
    sidepodTopR: { rect: px(0, 304, 256, 72), u: { axis: 'z', from: 0.66, to: -1.6 }, v: { axis: 'x', from: 0.12, to: 0.76 }, role: 'body', description: 'Right sidepod top / waterslide (front at left, outboard edge at bottom)' },
    sidepodTopL: { rect: px(260, 304, 256, 72), u: { axis: 'z', from: 0.66, to: -1.6 }, v: { axis: 'x', from: -0.76, to: -0.12 }, role: 'body', description: 'Left sidepod top / waterslide (front at left, outboard edge at top)' },
    rearWing: { rect: px(520, 236, 256, 124), u: { axis: 'x', from: 0.53, to: -0.53 }, v: { axis: 'z', from: -1.98, to: -2.5 }, role: 'accent', description: 'Rear wing mainplane + flap upper surfaces (as seen from behind the car)' },
    rearEndplateR: { rect: px(780, 236, 116, 148), u: { axis: 'z', from: -1.94, to: -2.52 }, v: { axis: 'y', from: 1.22, to: 0.56 }, role: 'body', description: 'Right rear-wing endplate (seen from the right)' },
    rearEndplateL: { rect: px(900, 236, 116, 148), u: { axis: 'z', from: -2.52, to: -1.94 }, v: { axis: 'y', from: 1.22, to: 0.56 }, role: 'body', description: 'Left rear-wing endplate (seen from the left)' },
    frontEndplateR: { rect: px(0, 380, 128, 92), u: { axis: 'z', from: 2.95, to: 2.33 }, v: { axis: 'y', from: 0.46, to: 0.02 }, role: 'secondary', description: 'Right front-wing endplate (seen from the right)' },
    frontEndplateL: { rect: px(132, 380, 128, 92), u: { axis: 'z', from: 2.33, to: 2.95 }, v: { axis: 'y', from: 0.46, to: 0.02 }, role: 'secondary', description: 'Left front-wing endplate (seen from the left)' },
  },
};

/** UV (GL convention, v up, flipY texture) for a car-space point inside a region. */
export function atlasUV(id: AtlasRegionId, x: number, y: number, z: number, out: [number, number]) {
  const r = LIVERY_ATLAS.regions[id];
  const val = (a: Axis) => (a === 'x' ? x : a === 'y' ? y : z);
  const t = (m: AtlasRegion['u']) => Math.min(1, Math.max(0, (val(m.axis) - m.from) / (m.to - m.from)));
  const fill = id === 'halo' || id === 'underside';
  const tu = fill ? 0.5 : t(r.u);
  const tv = fill ? 0.5 : t(r.v);
  out[0] = r.rect[0] + r.rect[2] * tu;
  out[1] = 1 - (r.rect[1] + r.rect[3] * tv);
  return out;
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

const CARBON = '#15181d';
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function bodyColor(l: Required<Livery>, p: { x: number; y: number; z: number }, P: THREE.Color, S: THREE.Color, A: THREE.Color, out: THREE.Color) {
  out.copy(P);
  if (l.pattern === 'split') {
    // flat line kept below the sidepod tops so intersecting surfaces never disagree
    const line = 0.355;
    out.lerpColors(S, P, smooth(line - 0.004, line + 0.004, p.y));
    if (p.z > 2.45) out.copy(S);
  } else if (l.pattern === 'stripe') {
    const ax = Math.abs(p.x);
    if (p.y > 0.28) {
      if (ax < 0.075) out.copy(S);
      else if (ax < 0.095) out.copy(A);
    }
  } else if (l.pattern === 'fade') {
    out.lerpColors(P, S, smooth(0.9, -1.1, p.z));
  }
  return out;
}

export interface LiveryLogo {
  region: AtlasRegionId;
  image: CanvasImageSource;
  /** sub-rect inside the region, normalised 0..1 (default: centred, contain-fit with 10% margin) */
  at?: [number, number, number, number];
}

/**
 * Render a livery into the atlas layout (base colours + optional logos). Works in the
 * browser (HTMLCanvasElement) — for build-time generation run it with a canvas polyfill.
 */
export function paintLiveryCanvas(livery: Livery | string, logos: LiveryLogo[] = [], width = LIVERY_ATLAS.width, height = LIVERY_ATLAS.height): HTMLCanvasElement {
  const l = resolveLivery(livery, '#888888', '#D4FF00');
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  g.fillStyle = CARBON;
  g.fillRect(0, 0, width, height);
  const img = g.getImageData(0, 0, width, height);
  const d = img.data;
  const P = new THREE.Color(l.primary);
  const S = new THREE.Color(l.secondary);
  const A = new THREE.Color(l.accent);
  const K = new THREE.Color(CARBON);
  const col = new THREE.Color();
  const pt = { x: 0, y: 0, z: 0 };
  const bleed = 3;
  for (const [id, r] of Object.entries(LIVERY_ATLAS.regions) as [AtlasRegionId, AtlasRegion][]) {
    const x0 = Math.max(0, Math.floor(r.rect[0] * width) - bleed);
    const y0 = Math.max(0, Math.floor(r.rect[1] * height) - bleed);
    const x1 = Math.min(width, Math.ceil((r.rect[0] + r.rect[2]) * width) + bleed);
    const y1 = Math.min(height, Math.ceil((r.rect[1] + r.rect[3]) * height) + bleed);
    const side = id.endsWith('L') ? -1 : 1;
    for (let py = y0; py < y1; py++) {
      for (let pxl = x0; pxl < x1; pxl++) {
        const tu = Math.min(1, Math.max(0, ((pxl + 0.5) / width - r.rect[0]) / r.rect[2]));
        const tv = Math.min(1, Math.max(0, ((py + 0.5) / height - r.rect[1]) / r.rect[3]));
        // defaults for the axis not covered by the projection
        pt.x = side * 0.3;
        pt.y = 0.7;
        pt.z = 0;
        pt[r.u.axis] = r.u.from + (r.u.to - r.u.from) * tu;
        pt[r.v.axis] = r.v.from + (r.v.to - r.v.from) * tv;
        if (r.role === 'body') bodyColor(l, pt, P, S, A, col);
        else col.copy(r.role === 'accent' ? A : r.role === 'secondary' ? S : K);
        col.convertLinearToSRGB();
        const i = (py * width + pxl) * 4;
        d[i] = col.r * 255;
        d[i + 1] = col.g * 255;
        d[i + 2] = col.b * 255;
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  for (const logo of logos) {
    const r = LIVERY_ATLAS.regions[logo.region];
    const rx = r.rect[0] * width;
    const ry = r.rect[1] * height;
    const rw = r.rect[2] * width;
    const rh = r.rect[3] * height;
    if (logo.at) {
      g.drawImage(logo.image, rx + logo.at[0] * rw, ry + logo.at[1] * rh, logo.at[2] * rw, logo.at[3] * rh);
    } else {
      const iw = (logo.image as { width: number }).width || 1;
      const ih = (logo.image as { height: number }).height || 1;
      const k = Math.min((rw * 0.8) / iw, (rh * 0.8) / ih);
      g.drawImage(logo.image, rx + (rw - iw * k) / 2, ry + (rh - ih * k) / 2, iw * k, ih * k);
    }
  }
  return c;
}

const texCache = new Map<string, THREE.CanvasTexture>();

/** Cached atlas texture with the base livery colours (shared by every car with that livery). */
export function getLiveryTexture(l: Required<Livery>, small = false): THREE.CanvasTexture {
  const key = `${l.primary}|${l.secondary}|${l.accent}|${l.pattern}|${small ? 's' : 'l'}`;
  let t = texCache.get(key);
  if (t) return t;
  const canvas = paintLiveryCanvas(l, [], small ? 512 : 1024, small ? 256 : 512);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
