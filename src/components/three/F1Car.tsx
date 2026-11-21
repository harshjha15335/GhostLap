import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeElements } from '@react-three/fiber';

/**
 * Procedural 2026-spec F1 car built from primitives (no licensed model / livery).
 * Structured as 8 separable sub-assemblies so /season can render an exploded view.
 *
 * Conventions (shared by landing, replay and season):
 *   - forward = +Z, up = +Y, origin at the centre of the floor
 *   - real-world-ish metres: ~5.2 long, ~1.9 wide (scale as needed)
 *
 * Props:
 *   color        team / body colour
 *   accent       wing + halo accent (default neon chartreuse)
 *   ghost        translucent emissive "Ghost Car" look (cyan)
 *   tyreGlow     0..1 intensity of the glowing compound rings
 *   tyreColor    compound ring colour (see COMPOUND_COLORS)
 *   detail       'high' (hero / season) | 'low' (22-car replay)
 *   explode      0..1 — separates the 8 sub-assemblies along EXPLODE_VECTORS
 *   highlight    sub-assembly ids that pulse ghost-cyan (upgrade highlight)
 *   onPartHover  called with the hovered sub-assembly id (null on leave)
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
  frontWing: [0, 0.9, 2.2],
  monocoque: [0, 0, 0],
  floor: [0, -1.3, 0],
  sidepods: [1.4, 0, 0], // mirrored per side
  ice: [0, 2.0, -0.2],
  ers: [0, 1.2, -1.4],
  gearbox: [0, 0.1, -2.0],
  rearWing: [0, 1.4, -2.6],
};

/** Approx centre of each sub-assembly in car space when assembled — anchor for callout leaders. */
export const PART_ANCHORS: Record<CarPartId, [number, number, number]> = {
  frontWing: [0, 0.15, 2.5],
  monocoque: [0, 0.6, 0.4],
  floor: [0, 0.08, -0.1],
  sidepods: [0.55, 0.36, -0.2],
  ice: [0, 0.6, -0.7],
  ers: [0, 0.4, -0.3],
  gearbox: [0, 0.35, -1.7],
  rearWing: [0, 0.95, -2.15],
};

export type F1CarProps = ThreeElements['group'] & {
  color?: string;
  accent?: string;
  ghost?: boolean;
  tyreGlow?: number;
  tyreColor?: string;
  detail?: 'high' | 'low';
  explode?: number;
  highlight?: CarPartId[];
  onPartHover?: (id: CarPartId | null) => void;
};

export const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#FF1E1E',
  MEDIUM: '#FFD400',
  HARD: '#F2F2F2',
  INTERMEDIATE: '#3BD16F',
  WET: '#2F7BFF',
};

const GHOST = new THREE.Color('#00F5D4');

/** easeOutCubic, clamped to 0..1 — the curve used for the explode animation. */
export const easeExplode = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * One explodable sub-assembly. Module-level (not defined inside F1Car) so React keeps the
 * same component identity across renders and only the position prop changes as `e` moves.
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
    ghost = false,
    tyreGlow = 0.8,
    tyreColor = '#FF1E1E',
    detail = 'high',
    explode = 0,
    highlight,
    onPartHover,
    ...group
  },
  ref,
) {
  const seg = detail === 'high' ? 28 : 12;
  const hl = useMemo(() => new Set(highlight ?? []), [highlight]);

  // Base materials depend only on livery/ghost; tyre ring is updated in place so that
  // per-frame tyre-wear changes (replay) never rebuild or leak materials.
  const mats = useMemo(() => {
    const body = ghost
      ? new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.35 });
    const carbon = ghost ? body : new THREE.MeshStandardMaterial({ color: '#111418', metalness: 0.2, roughness: 0.6 });
    const acc = ghost ? body : new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.4 });
    const tyre = ghost ? body : new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.9 });
    const metal = ghost ? body : new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.85, roughness: 0.3 });
    const ring = new THREE.MeshStandardMaterial({ toneMapped: false });
    const ersCore = new THREE.MeshStandardMaterial({ color: '#0a1a1a', emissive: GHOST, emissiveIntensity: ghost ? 0.9 : 0.6, toneMapped: false });
    const ersWarn = new THREE.MeshStandardMaterial({ color: '#1a0f05', emissive: new THREE.Color('#FF7A00'), emissiveIntensity: 0.7, toneMapped: false });
    const pulse = new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 1.2, transparent: true, opacity: 0.9, toneMapped: false });
    return { body, carbon, acc, tyre, metal, ring, ersCore, ersWarn, pulse };
  }, [color, accent, ghost]);

  useEffect(
    () => () => {
      new Set(Object.values(mats)).forEach((mat) => mat.dispose());
    },
    [mats],
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
  const m = (id: CarPartId, normal: THREE.Material) => (hl.has(id) ? mats.pulse : normal);

  const wheel = (x: number, z: number, r: number, w: number, key: string) => (
    <group key={key} position={[x, r, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={mats.tyre} castShadow>
        <cylinderGeometry args={[r, r, w, seg]} />
      </mesh>
      <mesh material={mats.ring} position={[0, x > 0 ? w / 2 + 0.005 : -w / 2 - 0.005, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.72, r * 0.06, 6, seg]} />
      </mesh>
    </group>
  );

  return (
    <group ref={ref} {...group}>
      {/* 3 — Underfloor & Venturi tunnels (wheels stay with the floor's datum, not exploded) */}
      <PartGroup e={e} onHover={onPartHover} id="floor">
        <mesh material={m('floor', mats.carbon)} position={[0, 0.08, -0.1]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.05, 3.6]} />
        </mesh>
        {detail === 'high' &&
          [-0.45, -0.15, 0.15, 0.45].map((x) => (
            <mesh key={`strake${x}`} material={m('floor', mats.carbon)} position={[x, 0.03, -0.6]}>
              <boxGeometry args={[0.02, 0.08, 1.4]} />
            </mesh>
          ))}
      </PartGroup>

      {/* 2 — Monocoque, nose, cockpit & halo (anchor) */}
      <PartGroup e={e} onHover={onPartHover} id="monocoque">
        <mesh material={m('monocoque', mats.body)} position={[0, 0.42, 0.25]} castShadow>
          <boxGeometry args={[0.62, 0.42, 2.6]} />
        </mesh>
        <mesh material={m('monocoque', mats.body)} position={[0, 0.36, 2.0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.26, 1.3, seg]} />
        </mesh>
        <mesh material={mats.carbon} position={[0, 0.64, 0.45]}>
          <boxGeometry args={[0.42, 0.05, 0.7]} />
        </mesh>
        <mesh material={m('monocoque', mats.acc)} position={[0, 0.82, 0.38]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.035, 8, seg, Math.PI]} />
        </mesh>
        <mesh material={m('monocoque', mats.acc)} position={[0, 0.76, 0.74]} rotation={[0.35, 0, 0]}>
          <boxGeometry args={[0.05, 0.18, 0.05]} />
        </mesh>
        {/* engine cover shell + airbox (stays with chassis so the ICE can lift out of it) */}
        <mesh material={m('monocoque', mats.body)} position={[0, 0.74, -0.75]} castShadow>
          <boxGeometry args={[0.46, 0.14, 1.5]} />
        </mesh>
        <mesh material={mats.carbon} position={[0, 0.92, -0.25]}>
          <boxGeometry args={[0.24, 0.3, 0.34]} />
        </mesh>
        {/* front suspension stays on chassis */}
        {detail === 'high' &&
          [-1, 1].map((s) => (
            <mesh key={`fwb${s}`} material={mats.carbon} position={[s * 0.5, 0.38, 1.65]} rotation={[0, 0, s * 0.15]}>
              <boxGeometry args={[0.7, 0.025, 0.06]} />
            </mesh>
          ))}
        {wheel(-0.86, 1.65, 0.36, 0.3, 'fl')}
        {wheel(0.86, 1.65, 0.36, 0.3, 'fr')}
      </PartGroup>

      {/* 1 — Front wing */}
      <PartGroup e={e} onHover={onPartHover} id="frontWing">
        <mesh material={m('frontWing', mats.acc)} position={[0, 0.12, 2.55]} castShadow>
          <boxGeometry args={[1.8, 0.03, 0.34]} />
        </mesh>
        <mesh material={m('frontWing', mats.carbon)} position={[0, 0.2, 2.45]} rotation={[-0.25, 0, 0]}>
          <boxGeometry args={[1.7, 0.025, 0.22]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={`fep${s}`} material={m('frontWing', mats.carbon)} position={[s * 0.9, 0.18, 2.5]}>
            <boxGeometry args={[0.03, 0.18, 0.46]} />
          </mesh>
        ))}
      </PartGroup>

      {/* 4 — Sidepods (mirrored outward) */}
      {([-1, 1] as const).map((s) => (
        <PartGroup key={`pod${s}`} id="sidepods" mirror={s} e={e} onHover={onPartHover}>
          <mesh material={m('sidepods', mats.body)} position={[s * 0.55, 0.36, -0.2]} castShadow>
            <boxGeometry args={[0.42, 0.36, 1.7]} />
          </mesh>
          {detail === 'high' &&
            [0, 1, 2, 3].map((i) => (
              <mesh key={`louv${i}`} material={mats.carbon} position={[s * 0.55, 0.55, -0.55 - i * 0.14]}>
                <boxGeometry args={[0.3, 0.012, 0.06]} />
              </mesh>
            ))}
        </PartGroup>
      ))}

      {/* 5 — ICE & turbo */}
      <PartGroup e={e} onHover={onPartHover} id="ice">
        <mesh material={m('ice', mats.metal)} position={[0, 0.5, -0.75]} castShadow>
          <boxGeometry args={[0.4, 0.3, 0.9]} />
        </mesh>
        {detail === 'high' &&
          [-1, 1].map((s) => (
            <mesh key={`bank${s}`} material={m('ice', mats.carbon)} position={[s * 0.14, 0.68, -0.75]} rotation={[0, 0, s * 0.5]}>
              <boxGeometry args={[0.12, 0.1, 0.84]} />
            </mesh>
          ))}
        <mesh material={m('ice', mats.metal)} position={[0, 0.55, -1.28]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.22, seg]} />
        </mesh>
      </PartGroup>

      {/* 6 — MGU-K, energy store & control electronics */}
      <PartGroup e={e} onHover={onPartHover} id="ers">
        <mesh material={m('ers', mats.ersCore)} position={[0, 0.3, -0.25]}>
          <boxGeometry args={[0.36, 0.12, 0.5]} />
        </mesh>
        <mesh material={m('ers', mats.ersWarn)} position={[0.12, 0.3, -1.05]}>
          <cylinderGeometry args={[0.08, 0.08, 0.16, seg]} />
        </mesh>
        <mesh material={m('ers', mats.carbon)} position={[-0.12, 0.42, -0.05]}>
          <boxGeometry args={[0.14, 0.06, 0.2]} />
        </mesh>
      </PartGroup>

      {/* 7 — Gearbox, rear suspension, diffuser & rear wheels */}
      <PartGroup e={e} onHover={onPartHover} id="gearbox">
        <mesh material={m('gearbox', mats.carbon)} position={[0, 0.35, -1.65]} castShadow>
          <boxGeometry args={[0.32, 0.28, 0.7]} />
        </mesh>
        <mesh material={m('gearbox', mats.carbon)} position={[0, 0.18, -1.95]} rotation={[-0.3, 0, 0]}>
          <boxGeometry args={[1.0, 0.04, 0.4]} />
        </mesh>
        {detail === 'high' &&
          [-1, 1].map((s) => (
            <mesh key={`rwb${s}`} material={mats.carbon} position={[s * 0.5, 0.38, -1.55]} rotation={[0, 0, s * 0.12]}>
              <boxGeometry args={[0.66, 0.025, 0.06]} />
            </mesh>
          ))}
        {wheel(-0.84, -1.55, 0.37, 0.38, 'rl')}
        {wheel(0.84, -1.55, 0.37, 0.38, 'rr')}
      </PartGroup>

      {/* 8 — Rear wing with active flap */}
      <PartGroup e={e} onHover={onPartHover} id="rearWing">
        <mesh material={m('rearWing', mats.acc)} position={[0, 0.98, -2.15]} rotation={[0.12, 0, 0]} castShadow>
          <boxGeometry args={[1.0, 0.04, 0.34]} />
        </mesh>
        <mesh material={m('rearWing', mats.carbon)} position={[0, 0.82, -2.18]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.98, 0.03, 0.22]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={`rep${s}`} material={m('rearWing', mats.body)} position={[s * 0.5, 0.82, -2.15]}>
            <boxGeometry args={[0.03, 0.5, 0.5]} />
          </mesh>
        ))}
        <mesh material={m('rearWing', mats.carbon)} position={[0, 0.62, -2.05]}>
          <boxGeometry args={[0.06, 0.5, 0.08]} />
        </mesh>
      </PartGroup>
    </group>
  );
});

/** Rear tyre contact points in car space — used for skid-mark trails. */
export const REAR_TYRE_OFFSETS: [number, number, number][] = [
  [-0.84, 0, -1.55],
  [0.84, 0, -1.55],
];

/** Small helper hook: smoothly animate a numeric value toward a target each frame. */
export function useDamped(target: number, lambda = 6) {
  const v = useRef(target);
  useFrame((_, dt) => {
    v.current = THREE.MathUtils.damp(v.current, target, lambda, dt);
  });
  return v;
}
