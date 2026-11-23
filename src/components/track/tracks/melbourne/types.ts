export type Point2D = [number, number];

export interface AlbertParkRoad {
  /** relative road width weight (1.0 = major arterial, 0.6 = park/local road) */
  w: number;
  pts: Point2D[];
}

export interface AlbertParkGrandstand {
  name: string;
  u0: number;
  u1: number;
  side: 1 | -1;
  rows: number;
  roofed: boolean;
}

export interface AlbertParkBridge {
  name: string;
  u: number;
  brand: string;
}

export interface AlbertParkAtlasEntry {
  id: string;
  label: string;
  /** [u0, v0, u1, v1] normalized texture coordinates */
  uv: [number, number, number, number];
}

export interface AlbertParkAdPlacement {
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
 * kind: 0 = park venue/stadium/boatshed, 1 = suburb low-rise, 2 = St Kilda Rd / Melbourne CBD tower
 */
export type AlbertParkBuilding = [number, number, number, number, number, number, 0 | 1 | 2];

/**
 * Compact OSM parkland tree:
 * [x, z, scale, type] where type 0 = Australian eucalyptus/gum, 1 = lakeside palm
 */
export type AlbertParkTree = [number, number, number, 0 | 1];

export interface AlbertParkEnvData {
  meta: {
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
  };
  lake: Point2D[][];
  islands: Point2D[][];
  bay: Point2D[];
  ovals: Point2D[][];
  golf: Point2D[][];
  roads: AlbertParkRoad[];
  paths: Point2D[][];
  buildings: AlbertParkBuilding[];
  trees: AlbertParkTree[];
  grandstands: AlbertParkGrandstand[];
  bridges: AlbertParkBridge[];
  atlas: AlbertParkAtlasEntry[];
  ads: AlbertParkAdPlacement[];
}
