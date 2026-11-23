export type Point2D = [number, number];

export interface EnvRoad {
  /** relative road width weight (1.0 = major arterial, 0.6 = park/local road) */
  w: number;
  pts: Point2D[];
}

export interface EnvGrandstand {
  name: string;
  u0: number;
  u1: number;
  side: 1 | -1;
  rows: number;
  roofed: boolean;
}

export interface EnvBridge {
  name: string;
  u: number;
  brand: string;
}

export interface EnvAtlasEntry {
  id: string;
  label: string;
  /** [u0, v0, u1, v1] normalized texture coordinates */
  uv: [number, number, number, number];
}

export interface EnvAdPlacement {
  u: number;
  side: 1 | -1;
  brand: string;
  len: number;
  h: number;
  kind: 'board' | 'brake' | 'decal';
}

/**
 * Compact OSM-aligned building box:
 * [cx, cz, width, depth, heightRender, yawRad, kind]
 * kind: 0 = circuit/park venue, 1 = residential/industrial low-rise, 2 = tall tower / skyline
 */
export type EnvBuilding = [number, number, number, number, number, number, 0 | 1 | 2];

/**
 * Compact OSM tree:
 * [x, z, scale, type] (circuit-specific tree type 0 or 1)
 */
export type EnvTree = [number, number, number, 0 | 1];

export interface CircuitEnvMeta {
  circuit: string;
  event2026: string;
  attribution: string;
  alignmentRmsM: number;
  alignmentMaxM: number;
  transform: {
    originE: number;
    originN: number;
    flipY: number;
    scale: number;
    theta: number;
    tx: number;
    tz: number;
    northVec: Point2D;
  };
}

export interface CircuitEnvData {
  meta: CircuitEnvMeta;
  lake: Point2D[][];
  islands: Point2D[][];
  bay: Point2D[];
  ovals: Point2D[][];
  golf: Point2D[][];
  roads: EnvRoad[];
  paths: Point2D[][];
  buildings: EnvBuilding[];
  trees: EnvTree[];
  grandstands: EnvGrandstand[];
  bridges: EnvBridge[];
  atlas: EnvAtlasEntry[];
  ads: EnvAdPlacement[];
}
