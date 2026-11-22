/**
 * Shared DOM <-> 3D layout for the landing page.
 *
 * Chapter 3 ("scroll drive") laps a real circuit: after a short intro (overview of
 * the whole circuit) the chapter's scroll maps linearly to lap fraction 0..1, then an
 * outro pulls back to the overview. The editorial cards live in a sticky stage and
 * travel past the car on the sides, each tied to a point of the lap.
 */

export const FOV = 40;
/** world z where the S-curve region (ch.4) is centred */
export const S_CENTER_Z = 190;
/** world z of the ghost undercut straight (ch.5) */
export const U_CENTER_Z = 300;

export const CHAPTER_COUNT = 8;
/** chapters 0..3 are camera moves in the WebGL world; 4.. are DOM-only (canvas paused) */
export const SCENE_CHAPTERS = 4;
export const CHAPTER_IDS = ['hero', 'specimen', 'drive', 'flow', 'strategist', 'everylap', 'launch', 'pit-exit'] as const;
export const CHAPTER_LABELS = ['Hero', 'Specimen', 'Scroll Drive', '22-Car Flow', 'Strategist', 'Every Lap', 'Launch', 'Pit Exit'];

/** lap fraction each editorial card is centred on */
export const CARD_LAPS = [0.1, 0.26, 0.42, 0.58, 0.74, 0.9];
/** half-width (lap fraction) of the scroll window in which a card is on screen */
export const CARD_HALF = 0.09;

export interface LandingLayout {
  vw: number;
  vh: number;
  mobile: boolean;
  /** px of scroll from the drive section top before the lap starts (overview + dive) */
  introPx: number;
  /** px of scroll for one full lap */
  drivePx: number;
  /** px of scroll pulling back to the overview after the flag */
  outroPx: number;
  /** total drive section height, px */
  sectionPx: number;
  /** screen y fraction where the car sits while driving */
  carScreenY: number;
  cardW: number;
  /** card left (px) for side -1 (left) and +1 (right) */
  cardLeft: { [side: number]: number };
  /** mobile: resting top of the card dock (px) */
  dockTop: number;
}

export function computeLayout(vw: number, vh: number): LandingLayout {
  const mobile = vw < 768;
  const introPx = Math.round(vh * 1.5);
  const drivePx = Math.round(vh * (mobile ? 8 : 9));
  const outroPx = Math.round(vh * 0.9);
  const sectionPx = introPx + drivePx + outroPx + Math.round(vh * 0.65);
  const carScreenY = mobile ? 0.3 : 0.56;
  const cardW = mobile ? vw - 24 : Math.round(Math.max(250, Math.min(400, vw / 2 - 150)));
  const cardLeft = mobile ? { [-1]: 12, [1]: 12 } : { [-1]: Math.max(16, Math.round(vw * 0.035)), [1]: Math.round(vw - Math.max(16, vw * 0.035) - cardW) };
  return { vw, vh, mobile, introPx, drivePx, outroPx, sectionPx, carScreenY, cardW, cardLeft, dockTop: Math.round(vh * 0.45) };
}

/** Lap fraction (0..1, clamped) for a given scrollY in the drive chapter. */
export function driveLapT(l: LandingLayout, scrollY: number, sectionTop: number): number {
  const t = (scrollY - sectionTop - l.introPx) / l.drivePx;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
