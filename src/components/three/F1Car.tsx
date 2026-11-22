import { forwardRef, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { getCarGeometry, REAR_AXLE_Z, REAR_TRACK_X, type MatKey, type PartMeshes } from './carGeometry';
import { cancelTeamLiveryRequest, getLiveryTexture, isSmallScreen, requestTeamLiveryTexture, resolveLivery, type Livery } from './liveries';

export type { Livery, LiveryPattern } from './liveries';
export { LIVERIES, LIVERY_ATLAS, paintLiveryCanvas } from './liveries';

/**
 * Procedural 2026-spec F1 car (no licensed model). Smooth lofted chassis, undercut
 * "waterslide" sidepods, multi-element wings, halo, push/pull-rod suspension, covered
 * wheels and authentic Pirelli sidewalls — geometry is built once per detail level and shared
 * by every instance (see carGeometry.ts); only materials are per instance.
 * Structured as 8 separable sub-assemblies so /season can render an exploded view.
 *
 * Conventions (shared by landing, replay and season):
 *   - forward = +Z, up = +Y, origin at the centre of the floor on the ground
 *   - real-world-ish metres: ~5.4 long, ~1.9 wide (scale as needed)
 *
 * Props:
 *   color        team / body colour (fallback when no `livery`)
 *   accent       wing + halo accent (fallback when no `livery`)
 *   teamId       team id (e.g. 'ferrari') — lazy-loads the team's baked livery atlas
 *                (public/liveries/<teamId>.webp, shared by all cars of the team) and uses
 *                LIVERIES[teamId] colours while it loads / if it's missing
 *   livery       team livery colours (object or teamId, see liveries.ts) — painted zones
 *   liveryTexture optional baked atlas texture (see LIVERY_ATLAS) — replaces the painted livery;
 *                still a single body material, so zero extra draw calls
 *   number       optional car number panel on the nose (detail="high" only)
 *   logoTexture  optional decal for the nose + sidepod decal slots (hidden when absent)
 *   ghost        translucent emissive "Ghost Car" look (cyan)
 *   tyreGlow     0..1 intensity of the glowing compound rings
 *   tyreColor    compound ring colour (see COMPOUND_COLORS)
 *   detail       'high' (hero / season) | 'low' (22-car replay)
 *   explode      0..1 — separates the 8 sub-assemblies along EXPLODE_VECTORS
 *   highlight    sub-assembly ids that pulse ghost-cyan (upgrade highlight)
 *   onPartHover  called with the hovered sub-assembly id (null on leave)
 *
 * Tyre compound rings: the ring material is MeshStandardMaterial with toneMapped=false and
 * userData.tyreRing = true (replay recolours it per frame).
 */
export type CarPartId =
  | 'frontWing'
  | 'monocoque'
  | 'floor'
  | 'sidepods'
  | 'ice'
  | 'ers'
  | 'gearbox'
  | 'rearWing';

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

/** Approx centre of each sub-assembly in car space when assembled — anchor for callout leaders. */
export const PART_ANCHORS: Record<CarPartId, [number, number, number]> = {
  frontWing: [0, 0.2, 2.62],
  monocoque: [0, 0.66, 0.7],
  floor: [0, 0.07, 0.1],
  sidepods: [0.62, 0.44, -0.15],
  ice: [0, 0.45, -0.95],
  ers: [0, 0.2, -0.25],
  gearbox: [0, 0.32, -1.72],
  rearWing: [0, 1.0, -2.25],
};

export type F1CarProps = ThreeElements['group'] & {
  color?: string;
  accent?: string;
  teamId?: string;
  livery?: Livery | string;
  liveryTexture?: THREE.Texture;
  number?: number;
  logoTexture?: THREE.Texture;
  ghost?: boolean;
  tyreGlow?: number;
  tyreColor?: string;
  detail?: 'high' | 'low';
  explode?: number;
  highlight?: CarPartId[];
  onPartHover?: (id: CarPartId | null) => void;
};

/** Official Pirelli F1 compound colours matching 2D TyreBadge.tsx */
export const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#E8002D',
  MEDIUM: '#FFD12E',
  HARD: '#F0F0EC',
  INTERMEDIATE: '#43B02A',
  WET: '#0067AD',
};

const GHOST = new THREE.Color('#00F5D4');

/** easeOutCubic, clamped to 0..1 — the curve used for the explode animation. */
export const easeExplode = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/* ---------------------------- Pirelli sidewall texture ---------------------------- */

let cachedPirelliTexture: THREE.CanvasTexture | null = null;

function getPirelliSidewallTexture(): THREE.CanvasTexture | null {
  if (cachedPirelliTexture) return cachedPirelliTexture;
  if (typeof document === 'undefined') return null;

  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  if (!g) return null;

  const cx = 256;
  const cy = 256;
  const R = 188;

  g.clearRect(0, 0, 512, 512);

  // Two thick white arcs: left (128° to 232°) and right (-52° to 52°)
  g.strokeStyle = '#ffffff';
  g.lineWidth = 16;
  g.lineCap = 'round';

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Right arc
  g.beginPath();
  g.arc(cx, cy, R, toRad(-52), toRad(52));
  g.stroke();

  // Left arc
  g.beginPath();
  g.arc(cx, cy, R, toRad(128), toRad(232));
  g.stroke();

  // Lettering: PIRELLI over top arc, P ZERO under bottom arc
  g.fillStyle = '#ffffff';
  g.font = 'bold italic 36px "Arial Black", Anton, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  const drawArcText = (str: string, midAngleDeg: number, radius: number, inward = true) => {
    const chars = str.split('');
    const stepDeg = 7.0;
    const totalDeg = chars.length * stepDeg;
    const startDeg = midAngleDeg - totalDeg / 2;
    chars.forEach((ch, idx) => {
      const angDeg = startDeg + (idx + 0.5) * stepDeg;
      const angRad = toRad(angDeg);
      const x = cx + Math.cos(angRad) * radius;
      const y = cy + Math.sin(angRad) * radius;
      g.save();
      g.translate(x, y);
      g.rotate(angRad + (inward ? Math.PI / 2 : -Math.PI / 2));
      g.fillText(ch, 0, 0);
      g.restore();
    });
  };

  // Top: PIRELLI
  drawArcText('PIRELLI', -90, R + 2, true);

  // Bottom: P ZERO
  drawArcText('P ZERO', 90, R + 2, false);

  cachedPirelliTexture = new THREE.CanvasTexture(c);
  cachedPirelliTexture.colorSpace = THREE.SRGBColorSpace;
  cachedPirelliTexture.anisotropy = 4;
  return cachedPirelliTexture;
}

/* ---------------------------- shared decal bits ---------------------------- */

const decalGeo = new THREE.PlaneGeometry(1, 1);
const numberTex = new Map<number, THREE.CanvasTexture>();
function getNumberTexture(n: number) {
  let t = numberTex.get(n);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0d11';
  g.beginPath();
  g.roundRect(4, 4, 120, 88, 16);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 66px Anton, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 52);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  numberTex.set(n, t);
  return t;
}

/** nose slope (rad) used to lay decals on the nose top */
const NOSE_LOGO = { pos: [0, 0.372, 2.12] as const, rot: -Math.PI / 2 + 0.25, size: [0.16, 0.2] as const };
const NOSE_NUMBER = { pos: [0, 0.545, 1.4] as const, rot: -Math.PI / 2 + 0.2, size: [0.24, 0.18] as const };
const POD_DECAL = { pos: [0.738, 0.455, 0.0] as const, size: [0.34, 0.13] as const };

/** The shared baked atlas for a team, or null until it has loaded (re-renders when it arrives). */
function useTeamLiveryTexture(teamId: string | undefined, small: boolean) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const tex = teamId ? requestTeamLiveryTexture(teamId, small, bump) : null;
  useEffect(() => {
    if (!teamId) return;
    return () => cancelTeamLiveryRequest(teamId, small, bump);
  }, [teamId, small]);
  return tex;
}

/**
 * One explodable sub-assembly. Module-level so React keeps the
 * same component identity across renders.
 */
function PartGroup({
  id,
  e,
  mirror = 1,
  onHover,
  children,
}: {
  id: CarPartId;
  e: number;
  mirror?: 1 | -1;
  onHover?: (id: CarPartId | null) => void;
  children: ReactNode;
}) {
  const v = EXPLODE_VECTORS[id];
  return (
    <group
      name={id}
      position={[v[0] * e * mirror, v[1] * e, v[2] * e]}
      onPointerOver={onHover ? (ev) => { ev.stopPropagation(); onHover(id); } : undefined}
      onPointerOut={onHover ? () => onHover(null) : undefined}
    >
      {children}
    </group>
  );
}

export const F1Car = forwardRef<THREE.Group, F1CarProps>(function F1Car(
  {
    color = '#D4FF00',
    accent = '#D4FF00',
    teamId,
    livery,
    liveryTexture,
    number,
    logoTexture,
    ghost = false,
    tyreGlow = 0.8,
    tyreColor = '#E8002D',
    detail = 'high',
    explode = 0,
    highlight,
    onPartHover,
    ...group
  },
  ref,
) {
  const geo = getCarGeometry(detail);
  const hl = useMemo(() => new Set(highlight ?? []), [highlight]);
  const tid = teamId ?? (typeof livery === 'string' ? livery : undefined);
  const liv = resolveLivery(livery ?? tid, color, accent);
  const teamTex = useTeamLiveryTexture(ghost || liveryTexture ? undefined : tid, detail === 'low' || isSmallScreen());

  // Base materials depend only on livery/ghost; tyre ring is updated in place so that
  // per-frame tyre-wear changes (replay) never rebuild or leak materials.
  const mats = useMemo(() => {
    const body = ghost
      ? new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, depthWrite: false })
      : new THREE.MeshStandardMaterial({ map: getLiveryTexture(liv, detail === 'low'), metalness: 0.35, roughness: 0.35 });
    const carbon = ghost ? body : new THREE.MeshStandardMaterial({ color: '#14171c', metalness: 0.25, roughness: 0.55 });
    const tyre = ghost ? body : new THREE.MeshStandardMaterial({ color: '#111113', roughness: 0.88 });
    const metal = ghost ? body : new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.85, roughness: 0.28 });

    // Compound ring / sidewall branding
    const pirelliMap = detail === 'high' && !ghost ? getPirelliSidewallTexture() : null;
    const ring = new THREE.MeshStandardMaterial({
      map: pirelliMap,
      transparent: detail === 'high' && !ghost,
      alphaTest: detail === 'high' && !ghost ? 0.05 : 0,
      roughness: 0.5,
      metalness: 0.1,
      toneMapped: false,
    });
    ring.userData.tyreRing = true;

    const ersCore = new THREE.MeshStandardMaterial({ color: '#0a1a1a', emissive: GHOST, emissiveIntensity: ghost ? 0.9 : 0.6, toneMapped: false });
    const ersWarn = new THREE.MeshStandardMaterial({ color: '#1a0f05', emissive: new THREE.Color('#FF7A00'), emissiveIntensity: 0.7, toneMapped: false });
    const pulse = new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 1.2, transparent: true, opacity: 0.9, toneMapped: false });
    return { body, carbon, tyre, metal, ring, ersCore, ersWarn, pulse } satisfies Record<MatKey | 'pulse', THREE.Material>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liv.primary, liv.secondary, liv.accent, liv.pattern, ghost, detail]);

  // swap the body map in place
  useLayoutEffect(() => {
    if (ghost) return;
    const map = liveryTexture ?? teamTex ?? getLiveryTexture(liv, detail === 'low');
    if (mats.body.map !== map) {
      mats.body.map = map;
      mats.body.needsUpdate = true;
    }
  });

  useEffect(
    () => () => {
      new Set(Object.values(mats)).forEach((mat) => mat.dispose());
    },
    [mats],
  );

  const decalMats = useMemo(() => {
    const num = number != null && detail === 'high' && !ghost ? new THREE.MeshStandardMaterial({ map: getNumberTexture(number), roughness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
    const logo = logoTexture && !ghost ? new THREE.MeshStandardMaterial({ map: logoTexture, roughness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
    return { num, logo };
  }, [number, detail, ghost, logoTexture]);
  useEffect(
    () => () => {
      decalMats.num?.dispose();
      decalMats.logo?.dispose();
    },
    [decalMats],
  );

  useLayoutEffect(() => {
    const c = ghost ? GHOST : mats.ring.color.set(tyreColor);
    mats.ring.color.copy(c);
    mats.ring.emissive.copy(c);
    mats.ring.emissiveIntensity = 0.4 + tyreGlow * 2.2;
  }, [mats, ghost, tyreColor, tyreGlow]);

  // upgrade pulse
  useFrame(({ clock }) => {
    if (hl.size) mats.pulse.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 5) * 0.7;
  });

  const e = easeExplode(explode);
  const shadow = detail === 'high';
  const meshes = (id: CarPartId, list: PartMeshes) =>
    list.map(({ mat, geo: g }, i) => {
      const keep = mat === 'ring' || mat === 'tyre';
      const material = hl.has(id) && !keep ? mats.pulse : mats[mat];
      return <mesh key={i} geometry={g} material={material} castShadow={shadow && mat !== 'ring'} receiveShadow={shadow && mat === 'body'} />;
    });

  return (
    <group ref={ref} {...group}>
      {/* 3 — Underfloor & Venturi tunnels */}
      <PartGroup e={e} onHover={onPartHover} id="floor">
        {meshes('floor', geo.floor)}
      </PartGroup>

      {/* 2 — Monocoque, nose, cockpit, halo, airbox, front suspension & wheels (anchor) */}
      <PartGroup e={e} onHover={onPartHover} id="monocoque">
        {meshes('monocoque', geo.monocoque)}
        {decalMats.num && (
          <mesh geometry={decalGeo} material={decalMats.num} position={NOSE_NUMBER.pos} rotation={[NOSE_NUMBER.rot, 0, 0]} scale={[NOSE_NUMBER.size[0], NOSE_NUMBER.size[1], 1]} />
        )}
        {decalMats.logo && (
          <mesh geometry={decalGeo} material={decalMats.logo} position={NOSE_LOGO.pos} rotation={[NOSE_LOGO.rot, 0, Math.PI]} scale={[NOSE_LOGO.size[0], NOSE_LOGO.size[1], 1]} />
        )}
      </PartGroup>

      {/* 1 — Front wing */}
      <PartGroup e={e} onHover={onPartHover} id="frontWing">
        {meshes('frontWing', geo.frontWing)}
      </PartGroup>

      {/* 4 — Sidepods (mirrored outward) */}
      {([-1, 1] as const).map((s) => (
        <PartGroup key={`pod${s}`} id="sidepods" mirror={s} e={e} onHover={onPartHover}>
          {meshes('sidepods', s > 0 ? geo.sidepodR : geo.sidepodL)}
          {decalMats.logo && (
            <mesh
              geometry={decalGeo}
              material={decalMats.logo}
              position={[s * POD_DECAL.pos[0], POD_DECAL.pos[1], POD_DECAL.pos[2]]}
              rotation={[0, (s * Math.PI) / 2, 0]}
              scale={[POD_DECAL.size[0], POD_DECAL.size[1], 1]}
            />
          )}
        </PartGroup>
      ))}

      {/* 5 — ICE, turbo & exhaust */}
      <PartGroup e={e} onHover={onPartHover} id="ice">
        {meshes('ice', geo.ice)}
      </PartGroup>

      {/* 6 — MGU-K, energy store & control electronics */}
      <PartGroup e={e} onHover={onPartHover} id="ers">
        {meshes('ers', geo.ers)}
      </PartGroup>

      {/* 7 — Gearbox, rear suspension, diffuser & rear wheels */}
      <PartGroup e={e} onHover={onPartHover} id="gearbox">
        {meshes('gearbox', geo.gearbox)}
      </PartGroup>

      {/* 8 — Rear wing (spoon mainplane, active flap, swan neck, beam wing) */}
      <PartGroup e={e} onHover={onPartHover} id="rearWing">
        {meshes('rearWing', geo.rearWing)}
      </PartGroup>
    </group>
  );
});

/** Rear tyre contact points in car space — used for skid-mark trails. */
export const REAR_TYRE_OFFSETS: [number, number, number][] = [
  [-REAR_TRACK_X, 0, REAR_AXLE_Z],
  [REAR_TRACK_X, 0, REAR_AXLE_Z],
];

/** Small helper hook: smoothly animate a numeric value toward a target each frame. */
export function useDamped(target: number, lambda = 6) {
  const v = useRef(target);
  useFrame((_, dt) => {
    v.current = THREE.MathUtils.damp(v.current, target, lambda, dt);
  });
  return v;
}
