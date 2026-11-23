import * as THREE from 'three';
import { Mesher, type V3 } from '../../mesher';
import { rng, type TrackModel } from '../../trackModel';
import type { Terrain } from '../../geometry';
import type { CircuitEnvData } from './types';

const C = (hex: string) => new THREE.Color(hex);

const ROOF_COLORS = {
  flat: C('#aeb6bf'),
  parapet: C('#cfd6de'),
  hvac: C('#8d97a3'),
  terracotta: C('#a85d46'),
  iron: C('#5c6670'),
};

/**
 * Emit a single wall quad with baked vertical Ambient Occlusion (darker base -> bright top)
 * and real-metre UVs mapped into one of the 4 columns of a shared facade atlas.
 */
export function pushAoWall(
  pos: number[],
  nor: number[],
  col: number[],
  uv: number[],
  a: V3,
  b: V3,
  c: V3,
  d: V3,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  tint: THREE.Color,
  aoBase = 0.72,
  aoTop = 1.0,
) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L;
  ny /= L;
  nz /= L;

  const verts: [V3, number, number, number][] = [
    [a, u0, v0, aoBase],
    [b, u1, v0, aoBase],
    [c, u0, v1, aoTop],
    [c, u0, v1, aoTop],
    [b, u1, v0, aoBase],
    [d, u1, v1, aoTop],
  ];
  for (const [p, uu, vv, ao] of verts) {
    pos.push(p[0], p[1], p[2]);
    nor.push(nx, ny, nz);
    col.push(tint.r * ao, tint.g * ao, tint.b * ao);
    uv.push(uu, vv);
  }
}

export interface BuildingAccumulators {
  fPos: number[];
  fNor: number[];
  fCol: number[];
  fUv: number[];
  roofs: Mesher;
}

/**
 * Build merged OSM architectural buildings into 2 draw calls (`facades` + `roofs`):
 * - Real-metre V-tiling (~3.4 m per floor, 8 floors per atlas height = 27.2 m)
 * - Baked vertical vertex AO
 * - Flat roofs with parapets + HVAC plant boxes on offices/towers, pitched gables on low houses
 */
export function accumulateOsmBuildings(
  m: TrackModel,
  terrain: Terrain,
  env: CircuitEnvData,
  quality: 'high' | 'low',
  seed = 20260308,
): BuildingAccumulators {
  const R = rng(seed);
  const scaleM = env.meta.transform.scale || m.upm;
  const fPos: number[] = [];
  const fNor: number[] = [];
  const fCol: number[] = [];
  const fUv: number[] = [];
  const roofs = new Mesher();
  const tint = new THREE.Color();

  for (const [cx, cz, rawW, rawD, rawH, yaw, kind] of env.buildings) {
    const w = Math.max(0.7, rawW);
    const d = Math.max(0.7, rawD);
    const h = Math.max(0.6, rawH);
    const inRect = cx >= terrain.rect.x0 && cx <= terrain.rect.x1 && cz >= terrain.rect.z0 && cz <= terrain.rect.z1;
    const baseY = inRect ? terrain.heightAt(cx, cz) - 0.14 : m.bounds.meanY - 0.25;

    let colIdx: number;
    if (kind === 2) colIdx = R() < 0.62 ? 0 : 1;
    else if (kind === 0) colIdx = 1;
    else colIdx = R() < 0.55 ? 2 : 3;

    const u0 = colIdx * 0.25 + 0.004;
    const u1 = (colIdx + 1) * 0.25 - 0.004;
    const heightM = h / Math.max(0.05, scaleM);
    const v1 = Math.max(0.18, heightM / 27.2);

    const shade = 0.88 + R() * 0.18;
    tint.setRGB(shade, shade, shade);
    if (kind === 2 && R() < 0.35) tint.lerp(C('#c7dff5'), 0.25);

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const hw = w * 0.5;
    const hd = d * 0.5;
    const pt = (lx: number, y: number, lz: number): V3 => [
      cx + lx * cos - lz * sin,
      baseY + y,
      cz + lx * sin + lz * cos,
    ];

    const b0 = pt(-hw, 0, -hd);
    const b1 = pt(hw, 0, -hd);
    const b2 = pt(hw, 0, hd);
    const b3 = pt(-hw, 0, hd);
    const t0 = pt(-hw, h, -hd);
    const t1 = pt(hw, h, -hd);
    const t2 = pt(hw, h, hd);
    const t3 = pt(-hw, h, hd);

    pushAoWall(fPos, fNor, fCol, fUv, b0, b1, t0, t1, u0, u1, 0, v1, tint);
    pushAoWall(fPos, fNor, fCol, fUv, b1, b2, t1, t2, u0, u1, 0, v1, tint);
    pushAoWall(fPos, fNor, fCol, fUv, b2, b3, t2, t3, u0, u1, 0, v1, tint);
    pushAoWall(fPos, fNor, fCol, fUv, b3, b0, t3, t0, u0, u1, 0, v1, tint);

    const isPitched = quality === 'high' && kind === 1 && h <= 1.25 && Math.min(w, d) < 4.5;
    if (isPitched) {
      const ridgeH = Math.min(w, d) * 0.28;
      const rc = R() < 0.55 ? ROOF_COLORS.terracotta : ROOF_COLORS.iron;
      if (w >= d) {
        const rL = pt(-hw, h + ridgeH, 0);
        const rR = pt(hw, h + ridgeH, 0);
        roofs.quad(t0, t1, rL, rR, rc);
        roofs.quad(t2, t3, rR, rL, rc);
        roofs.quad(t3, t0, rL, rL, rc);
        roofs.quad(t1, t2, rR, rR, rc);
      } else {
        const rF = pt(0, h + ridgeH, -hd);
        const rB = pt(0, h + ridgeH, hd);
        roofs.quad(t3, t0, rB, rF, rc);
        roofs.quad(t1, t2, rF, rB, rc);
        roofs.quad(t0, t1, rF, rF, rc);
        roofs.quad(t2, t3, rB, rB, rc);
      }
    } else {
      const roofCol = kind === 2 ? ROOF_COLORS.flat : ROOF_COLORS.parapet;
      roofs.quad(t0, t1, t3, t2, roofCol, true);
      if (quality === 'high' && (kind === 2 || h > 1.3)) {
        const ph = Math.min(0.28, h * 0.08);
        roofs.box([cx, baseY + h + ph * 0.5, cz], cos, sin, [hw * 0.98, ph * 0.5, hd * 0.98], ROOF_COLORS.parapet, roofCol);
        if (w > 1.8 && d > 1.8) {
          const hvacH = Math.min(0.65, h * 0.14);
          roofs.box(
            [cx, baseY + h + ph + hvacH * 0.5, cz],
            cos,
            sin,
            [hw * 0.36, hvacH * 0.5, hd * 0.32],
            ROOF_COLORS.hvac,
            ROOF_COLORS.flat,
          );
        }
      }
    }
  }

  return { fPos, fNor, fCol, fUv, roofs };
}

export function finalizeBuildings(acc: BuildingAccumulators): { facades: THREE.BufferGeometry; roofs: THREE.BufferGeometry } {
  const facades = new THREE.BufferGeometry();
  facades.setAttribute('position', new THREE.Float32BufferAttribute(acc.fPos, 3));
  facades.setAttribute('normal', new THREE.Float32BufferAttribute(acc.fNor, 3));
  facades.setAttribute('color', new THREE.Float32BufferAttribute(acc.fCol, 3));
  facades.setAttribute('uv', new THREE.Float32BufferAttribute(acc.fUv, 2));
  facades.computeBoundingSphere();
  return { facades, roofs: acc.roofs.geometry() };
}
