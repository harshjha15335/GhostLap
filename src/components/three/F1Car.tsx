import { Component, forwardRef, Suspense, useMemo, type ErrorInfo, type ReactNode } from 'react';
import type * as THREE from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { easeExplode, type CarPartId } from './carParts';
import { isSmallScreen, resolveLivery, type AtlasRes, type Livery } from './liveries';
import { ProceduralCar } from './ProceduralCar';
import { useLiveryAtlas, W17Low, W17Split } from './W17Car';
import type { W17Lod } from './w17';

export type { Livery, LiveryPattern } from './liveries';
export { LIVERIES, LIVERY_ATLAS, paintLiveryCanvas } from './liveries';
export type { CarPartId, CarPartInfo } from './carParts';
export { CAR_PARTS, COMPOUND_COLORS, EXPLODE_VECTORS, PART_ANCHORS, REAR_TYRE_OFFSETS, easeExplode } from './carParts';
export { useDamped } from './useDamped';

/**
 * The GhostLap car: the CC-BY "2026 Mercedes W17" model by Dave Love, decimated into three
 * LODs (scripts/models/build-w17.mjs) and re-skinned per team. Every car on every page goes
 * through this component.
 *
 * Conventions (shared by landing, replay and season):
 *   - forward = +Z, up = +Y, origin at the centre of the floor on the ground
 *   - real metres: ~5.39 long, ~1.92 wide (scale as needed)
 *
 * Props:
 *   detail       'high' (hero / turntable / exploded; 'mid' on small screens)
 *                | 'mid' (podium, secondary views) | 'low' (22-car replay: 2 draw calls)
 *                Each LOD's GLB loads on first use (no preload). While 'high'/'mid' load,
 *                the 43 KB low LOD stands in; if a GLB fails, the procedural car does.
 *   teamId       team id (e.g. 'ferrari') — the team's livery atlas (public/liveries) is
 *                projected onto the W17 bodywork; 'mercedes' / no team keeps the W17's own
 *                paint and sponsor decals (high / mid)
 *   livery       Livery object or teamId (custom colours are painted into the atlas)
 *   color/accent fallback colours when neither teamId nor livery resolve
 *   liveryTexture optional explicit atlas texture (LIVERY_ATLAS layout, flipY = true)
 *   number       car number on the nose / engine cover panels (high / mid)
 *   ghost        translucent emissive "Ghost Car" look (cyan)
 *   tyreGlow     0..1 glow of the compound colour (sidewall lettering / low-LOD rings)
 *   tyreColor    compound colour (see COMPOUND_COLORS)
 *   explode      0..1 — separates the 8 sub-assemblies along EXPLODE_VECTORS (high / mid)
 *   highlight    sub-assembly ids that pulse ghost-cyan (upgrade highlight)
 *   onPartHover  called with the hovered sub-assembly id (null on leave)
 *   useModel     false → always the procedural car
 *   logoTexture  accepted for compatibility (unused by the W17)
 *
 * Low-LOD compound ring material: MeshStandardMaterial, toneMapped=false,
 * userData.tyreRing = true (the replay recolours it in place).
 */
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
  detail?: W17Lod;
  explode?: number;
  highlight?: CarPartId[];
  onPartHover?: (id: CarPartId | null) => void;
  useModel?: boolean;
};

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('W17 model failed to load, using the procedural car:', error, info.componentStack);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

const ATLAS_RES: Record<W17Lod, AtlasRes> = { high: '2x', mid: 'md', low: 'sm' };
const NO_PARTS = new Set<CarPartId>();

export const F1Car = forwardRef<THREE.Group, F1CarProps>(function F1Car(props, ref) {
  const {
    color = '#0B0B0B',
    accent = '#00D7B6',
    teamId,
    livery,
    liveryTexture,
    number,
    logoTexture: _logoTexture,
    ghost = false,
    tyreGlow = 0.8,
    tyreColor = '#00D7B6',
    detail = 'high',
    explode = 0,
    highlight,
    onPartHover,
    useModel = true,
    ...group
  } = props;

  // LOD: phones get 'mid' for hero views; the exploded view needs the part-split LODs
  let lod: W17Lod = detail === 'high' && isSmallScreen() ? 'mid' : detail;
  if (explode > 0 && lod === 'low') lod = 'mid';

  const tid = teamId ?? (typeof livery === 'string' ? livery : livery ? undefined : 'mercedes');
  const liv = resolveLivery(livery ?? tid, color, accent);
  const ownPaint = !ghost && !liveryTexture && typeof livery !== 'object' && tid === 'mercedes';
  const atlas = useLiveryAtlas(ghost ? undefined : tid, ATLAS_RES[lod], liv, liveryTexture);
  const hl = useMemo(() => (highlight?.length ? new Set(highlight) : NO_PARTS), [highlight]);
  const e = easeExplode(explode);

  const procedural = (
    <ProceduralCar
      {...{ color, accent, teamId, livery, liveryTexture, number, ghost, tyreGlow, tyreColor, explode, highlight, onPartHover }}
      detail={detail}
    />
  );
  if (!useModel) {
    return (
      <group ref={ref} {...group}>
        {procedural}
      </group>
    );
  }

  const low = <W17Low ghost={ghost} atlas={atlas} tyreColor={tyreColor} tyreGlow={tyreGlow} />;
  const car =
    lod === 'low' ? (
      low
    ) : (
      <W17Split
        lod={lod}
        e={e}
        highlight={hl}
        onPartHover={onPartHover}
        ghost={ghost}
        atlas={ownPaint ? null : atlas}
        number={number}
        numberAccent={liv.secondary === liv.primary ? liv.accent : liv.secondary}
        tyreColor={tyreColor}
        tyreGlow={tyreGlow}
      />
    );
  // progressive: the tiny low LOD stands in while high / mid download (not when exploded)
  const placeholder = lod !== 'low' && e === 0 ? <Suspense fallback={null}>{low}</Suspense> : null;

  return (
    <group ref={ref} {...group}>
      <ModelErrorBoundary fallback={procedural}>
        <Suspense fallback={placeholder}>{car}</Suspense>
      </ModelErrorBoundary>
    </group>
  );
});
