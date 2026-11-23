/**
 * Shared car constants (W17 proportions). Conventions for every car in GhostLap:
 * forward = +Z, up = +Y, origin at the centre of the floor on the ground, metres
 * (the W17 is ~5.39 m long, ~1.92 m wide).
 */
export type CarPartId = 'frontWing' | 'monocoque' | 'floor' | 'sidepods' | 'ice' | 'ers' | 'gearbox' | 'rearWing';

export interface CarPartInfo {
  id: CarPartId;
  label: string;
  /** short CAD-style callout */
  callout: string;
}

export const CAR_PARTS: CarPartInfo[] = [
  { id: 'frontWing', label: 'Front Wing & Endplates', callout: 'FW-26 · active aero front element' },
  { id: 'monocoque', label: 'Monocoque / Halo & Survival Cell', callout: 'MC-26 · carbon tub, titanium halo' },
  { id: 'floor', label: 'Underfloor & Venturi Tunnels', callout: 'FL-26 · flat-bottom floor, edge strakes' },
  { id: 'sidepods', label: 'Sidepods & Cooling Louvres', callout: 'SP-26 · radiator inlets, louvres' },
  { id: 'ice', label: 'ICE & Turbocharger', callout: 'PU-ICE · 1.6L V6 turbo' },
  { id: 'ers', label: 'MGU-K, Energy Store & Control Electronics', callout: 'PU-ERS · 350 kW MGU-K, ES, CE' },
  { id: 'gearbox', label: 'Gearbox & Rear Suspension', callout: 'GB-26 · 8-speed seamless shift' },
  { id: 'rearWing', label: 'Rear Wing & Active-Aero Flap', callout: 'RW-26 · X-mode / Z-mode flap' },
];

/** Direction × distance (metres at explode = 1) each sub-assembly travels. */
export const EXPLODE_VECTORS: Record<CarPartId, [number, number, number]> = {
  frontWing: [0, 0.7, 2.1],
  monocoque: [0, 0, 0],
  floor: [0, -1.25, 0],
  sidepods: [1.45, 0.1, 0], // mirrored per side
  ice: [0, 2.0, -0.35],
  ers: [0, 1.15, -1.35],
  gearbox: [0, 0.1, -2.0],
  rearWing: [0, 1.4, -2.5],
};

/** Approx centre of each sub-assembly of the W17 in car space when assembled — anchor for callout leaders. */
export const PART_ANCHORS: Record<CarPartId, [number, number, number]> = {
  frontWing: [0, 0.3, 2.5],
  monocoque: [0, 0.78, 0.55],
  floor: [0, 0.1, -0.2],
  sidepods: [0.6, 0.45, -0.25],
  ice: [0, 0.55, -0.95],
  ers: [0, 0.22, -0.3],
  gearbox: [0, 0.36, -1.75],
  rearWing: [0, 0.92, -2.22],
};

/** W17 wheel positions (tyre centre, car space). */
export const W17_FRONT_AXLE_Z = 1.62;
export const W17_REAR_AXLE_Z = -1.78;
export const W17_REAR_TRACK_X = 0.74;
export const W17_WHEEL_R = 0.355;

/** Rear tyre contact points in car space — used for skid-mark trails. */
export const REAR_TYRE_OFFSETS: [number, number, number][] = [
  [-W17_REAR_TRACK_X, 0, W17_REAR_AXLE_Z],
  [W17_REAR_TRACK_X, 0, W17_REAR_AXLE_Z],
];

/** Official Pirelli F1 compound colours matching 2D TyreBadge.tsx */
export const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#E8002D',
  MEDIUM: '#FFD12E',
  HARD: '#F0F0EC',
  INTERMEDIATE: '#43B02A',
  WET: '#0067AD',
};

/** easeOutCubic, clamped to 0..1 — the curve used for the explode animation. */
export const easeExplode = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
