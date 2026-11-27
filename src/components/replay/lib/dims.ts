/**
 * Render-space constants shared by the replay scene (pure: no React / store imports,
 * so the lane maths can be unit-tested in node).
 */
export const TRACK_WIDTH = 3.4;
export const CAR_SCALE = 0.55;
export const PIT_LANE_OFFSET = TRACK_WIDTH / 2 + 1.35;
export const PIT_LANE_WIDTH = 1.3;
export const PIT_SPAN = 0.075;
export const GHOST_LANE = -1.05;
export const MIN_HALF_WIDTH = 1.5;

/** Car footprint used for collision-free placement: 5.4 m × 2 m, ≥ 0.5 m clearance (render units). */
export const CAR_LEN = 5.4 * CAR_SCALE;
export const CAR_WID = 2.0 * CAR_SCALE;
export const CAR_GAP = 0.5 * CAR_SCALE;
/** centre-to-centre clearances: along the track and across it */
export const CLEAR_S = CAR_LEN + CAR_GAP;
export const CLEAR_D = CAR_WID + CAR_GAP;
/** cars may put their outer wheels on the kerb */
export const KERB_ALLOW = 0.15;

/** Track-model options for the replay (Track.tsx renders with exactly these, lanes use them too). */
export const REPLAY_TRACK_OPTS = {
  quality: 'low' as const,
  trackWidth: TRACK_WIDTH,
  minHalfWidth: MIN_HALF_WIDTH,
  pitLane: { offset: PIT_LANE_OFFSET, width: PIT_LANE_WIDTH },
  pitSpan: PIT_SPAN,
};
