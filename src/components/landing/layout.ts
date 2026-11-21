/**
 * Shared DOM <-> 3D layout for the landing page.
 *
 * Chapter 3 ("scroll drive") is a lockstep section: a top-down camera is placed so
 * that 1 world unit == `ppw` CSS px, then translated in exact proportion to scrollY.
 * World geometry laid along +Z therefore scrolls with the DOM, and the editorial
 * cards (positioned in px by the same numbers) stay glued to the tyre marks.
 */

export const FOV = 40;
export const CAR_LEN = 5.2;
/** world-unit length of the lockstep drive */
export const DRIVE_LEN = 96;
/** world z where the S-curve region (ch.4) is centred */
export const S_CENTER_Z = 190;
/** world z of the ghost undercut straight (ch.5) */
export const U_CENTER_Z = 300;

export const CHAPTER_COUNT = 6;
export const CHAPTER_IDS = ['hero', 'specimen', 'drive', 'flow', 'undercut', 'launch'] as const;
export const CHAPTER_LABELS = ['Hero', 'Specimen', 'Scroll Drive', '22-Car Flow', 'Ghost Undercut', 'Launch Gate'];

/** card anchor fractions along the drive */
export const CARD_FRACS = [0.06, 0.22, 0.38, 0.54, 0.7, 0.86];
/** -1 = card on the left (tyre marks swing right), +1 = card on the right */
export const CARD_SIDES: (1 | -1)[] = [-1, 1, -1, 1, -1, 1];

export interface PathKey {
  z: number;
  x: number;
}

export interface LandingLayout {
  vw: number;
  vh: number;
  mobile: boolean;
  /** px per world unit in the drive section */
  ppw: number;
  /** top-down camera height for the drive section */
  camH: number;
  /** px of scroll spent rotating the camera into top-down before the car moves */
  rotatePx: number;
  /** px of scroll during which the car drives DRIVE_LEN world units */
  lockPx: number;
  /** total drive section height, px */
  sectionPx: number;
  /** screen y fraction where the car sits while driving */
  carScreenY: number;
  cardW: number;
  /** card top (px, relative to the drive section top) and left (px, viewport) */
  cards: { top: number; left: number; side: 1 | -1 }[];
  keys: PathKey[];
}

const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);

export function computeLayout(vw: number, vh: number): LandingLayout {
  const mobile = vw < 768;
  const carPx = Math.min(150, Math.max(104, vh * 0.16));
  const ppw = carPx / CAR_LEN;
  const visibleH = vh / ppw;
  const camH = visibleH / (2 * tanHalf);
  const rotatePx = vh * 0.9;
  const lockPx = DRIVE_LEN * ppw;
  const carScreenY = 0.4;
  const sectionPx = Math.round(rotatePx + carScreenY * vh + lockPx + vh * 0.7);

  const cardW = mobile ? Math.round(vw * 0.76) : Math.round(Math.min(440, Math.max(340, vw * 0.3)));
  // lateral swing of the path (px from centre)
  const amp = mobile ? vw / 2 - 12 - (vw - 24 - cardW) / 2 : Math.min(260, vw * 0.17);

  const cards = CARD_FRACS.map((f, i) => {
    const side = CARD_SIDES[i];
    const anchorY = rotatePx + carScreenY * vh + f * lockPx; // doc offset where the car is level with this anchor
    const top = Math.round(anchorY - vh * 0.12);
    let left: number;
    if (mobile) {
      left = side < 0 ? 12 : vw - 12 - cardW;
    } else {
      // card's inner edge stops ~90px short of the tyre-mark centreline, so the
      // incoming swing passes under its corner
      const pathX = vw / 2 - side * amp;
      left = side < 0 ? pathX - 92 - cardW : pathX + 92;
      left = Math.max(16, Math.min(vw - 16 - cardW, left));
    }
    return { top, left: Math.round(left), side };
  });

  const keys: PathKey[] = [{ z: 0, x: 0 }];
  CARD_FRACS.forEach((f, i) => {
    keys.push({ z: f * DRIVE_LEN + (vh * 0.1) / ppw, x: (-CARD_SIDES[i] * amp) / ppw });
  });
  keys.push({ z: DRIVE_LEN + 6, x: 0 });
  keys.push({ z: DRIVE_LEN + 400, x: 0 });

  return { vw, vh, mobile, ppw, camH, rotatePx, lockPx, sectionPx, carScreenY, cardW, cards, keys };
}

/** Lateral path offset (world x) at world z — cosine-eased between keys (zero slope at each key). */
export function pathX(keys: PathKey[], z: number): number {
  if (z <= keys[0].z) return keys[0].x;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (z <= b.z) {
      const u = (z - a.z) / (b.z - a.z);
      return a.x + (b.x - a.x) * (1 - Math.cos(Math.PI * u)) * 0.5;
    }
  }
  return keys[keys.length - 1].x;
}

/** Heading (rotation about +Y) of a car following the path at z; forward = +Z. */
export function pathYaw(keys: PathKey[], z: number): number {
  const d = 0.25;
  const dx = pathX(keys, z + d) - pathX(keys, z - d);
  return Math.atan2(dx, 2 * d);
}

/** Car z for a given scrollY in the drive chapter (clamped 0..DRIVE_LEN). */
export function driveCarZ(l: LandingLayout, scrollY: number, sectionTop: number): number {
  const z = (scrollY - sectionTop - l.rotatePx) / l.ppw;
  return Math.max(0, Math.min(DRIVE_LEN, z));
}

/** Camera z (unclamped) so world geometry scrolls 1:1 with the DOM. */
export function driveCamZ(l: LandingLayout, scrollY: number, sectionTop: number): number {
  return (scrollY - sectionTop - l.rotatePx) / l.ppw + ((0.5 - l.carScreenY) * l.vh) / l.ppw;
}
