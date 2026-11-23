import { forwardRef, useEffect, useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { getCarGeometry, type MatKey, type PartMeshes } from './carGeometry';
import { cancelTeamLiveryRequest, getLiveryTexture, isSmallScreen, requestTeamLiveryTexture, resolveLivery } from './liveries';
import { EXPLODE_VECTORS, easeExplode, type CarPartId } from './carParts';
import type { F1CarProps } from './F1Car';

/**
 * The original procedural 2026 car (smooth lofted chassis, 8 separable sub-assemblies,
 * geometry shared per detail level — see carGeometry.ts). F1Car now renders the W17 model;
 * this stays as the fallback when the model can't load (and for `useModel={false}`).
 * Compound ring material: MeshStandardMaterial, toneMapped=false, userData.tyreRing = true.
 */

const GHOST = new THREE.Color('#00F5D4');

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

export const ProceduralCar = forwardRef<THREE.Group, F1CarProps>(function ProceduralCar(
  {
    color = '#0B0B0B',
    accent = '#00D7B6',
    teamId,
    livery,
    liveryTexture,
    number,
    logoTexture,
    ghost = false,
    tyreGlow = 0.8,
    tyreColor = '#00D7B6',
    detail = 'high',
    explode = 0,
    highlight,
    onPartHover,
    useModel: _useModel,
    ...group
  },
  ref,
) {
  const pd = detail === 'mid' ? 'high' : detail;
  const geo = getCarGeometry(pd);
  const hl = useMemo(() => new Set(highlight ?? []), [highlight]);
  const tid = teamId ?? (typeof livery === 'string' ? livery : (livery ? undefined : 'mercedes'));
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
    const pirelliMap = pd === 'high' && !ghost ? getPirelliSidewallTexture() : null;
    const ring = new THREE.MeshStandardMaterial({
      map: pirelliMap,
      transparent: pd === 'high' && !ghost,
      alphaTest: pd === 'high' && !ghost ? 0.05 : 0,
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
    const num = number != null && pd === 'high' && !ghost ? new THREE.MeshStandardMaterial({ map: getNumberTexture(number), roughness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
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
  const shadow = pd === 'high';
  const meshes = (id: CarPartId, list: PartMeshes) =>
    list.map(({ mat, geo: g }, i) => {
      const keep = mat === 'ring' || mat === 'tyre';
      const material = hl.has(id) && !keep ? mats.pulse : mats[mat];
      return <mesh key={i} geometry={g} material={material} castShadow={shadow && mat !== 'ring'} receiveShadow={shadow && mat === 'body'} />;
    });

  const proceduralCar = (
    <>
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
    </>
  );

  return (
    <group ref={ref} {...group}>
      {proceduralCar}
    </group>
  );
});
