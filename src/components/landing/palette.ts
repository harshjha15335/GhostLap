/**
 * Colours for the 3D chapters of the landing page (hero -> specimen -> drive -> 22-car flow).
 * "Pit-Lane Pop": an ultramarine sky over a hot-magenta horizon for the hero + specimen,
 * a sunshine ground for the scroll drive and an ultraviolet ground for the 22-car flow.
 * The canvas grounds and the DOM wipes share these exact values.
 */
export const PALETTE = {
  /** hero sky, above the curved horizon */
  sky: '#2D3BFF',
  /** hero/specimen ground, below the curved horizon */
  horizon: '#FF2E88',
  /** scroll-drive ground */
  drive: '#FFD23F',
  /** run-off strips beside the drive / S-curve roads */
  runoff: '#2D3BFF',
  /** 22-car flow ground */
  flow: '#7A2CFF',
  sun: '#FFD23F',
  ink: '#170F33',
  cream: '#FFF7EE',
  crimson: '#E10600',
} as const;
