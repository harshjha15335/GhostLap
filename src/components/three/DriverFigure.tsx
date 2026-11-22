import { forwardRef, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { resolveLivery, type Livery } from './liveries';

/**
 * Stylised standing race driver (helmet + visor, race suit, gloves, boots). No faces,
 * logos or sponsors. Low-poly, shared geometries; per-instance materials only.
 *
 * Conventions: origin at the feet, facing +Z, ~1.78 m tall (same metres as F1Car).
 *
 * Props:
 *   teamColor / accent   suit colours (fallback when no `livery`)
 *   livery               same livery object / teamId as F1Car (primary suit, secondary panels, accent stripes)
 *   number               car number on chest and back
 *   code                 optional initials painted on the helmet sides
 *   pose                 'stand' | 'celebrate' (both arms up, P1) | 'wave'
 */
export type DriverPose = 'stand' | 'celebrate' | 'wave';

export type DriverFigureProps = ThreeElements['group'] & {
  teamColor?: string;
  accent?: string;
  livery?: Livery | string;
  number?: number;
  code?: string;
  pose?: DriverPose;
};

/* ------------------------------ shared geometry ------------------------------ */

const G = (() => {
  const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 10);
  // torso: lathe profile from hips to shoulders, flattened front-to-back
  const prof = [
    [0.0, 0.84],
    [0.16, 0.86],
    [0.175, 0.95],
    [0.165, 1.08],
    [0.19, 1.26],
    [0.215, 1.37],
    [0.19, 1.45],
    [0.08, 1.5],
    [0.0, 1.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(prof, 18);
  torso.scale(1, 1, 0.66);
  const thigh = cap(0.09, 0.34);
  thigh.translate(0, -0.22, 0);
  const shin = cap(0.074, 0.34);
  shin.translate(0, -0.21, 0);
  const upperArm = cap(0.064, 0.19);
  upperArm.translate(0, -0.15, 0);
  const foreArm = cap(0.056, 0.17);
  foreArm.translate(0, -0.13, 0);
  const glove = new THREE.SphereGeometry(0.064, 10, 8);
  glove.scale(0.85, 1.15, 0.9);
  glove.translate(0, -0.3, 0);
  const boot = new THREE.CapsuleGeometry(0.068, 0.17, 3, 10);
  boot.rotateX(Math.PI / 2);
  boot.scale(1, 0.85, 1);
  boot.translate(0, 0.055, 0.04);
  const stripeLeg = new THREE.BoxGeometry(0.018, 0.8, 0.05);
  const stripeSide = new THREE.BoxGeometry(0.02, 0.42, 0.11);
  const belt = new THREE.CylinderGeometry(0.168, 0.168, 0.05, 18, 1, true);
  belt.scale(1, 1, 0.68);
  const collar = new THREE.CylinderGeometry(0.075, 0.095, 0.08, 14);
  const helmet = new THREE.SphereGeometry(0.152, 28, 18);
  helmet.scale(0.98, 1.02, 1.1);
  const visor = new THREE.SphereGeometry(0.156, 20, 6, Math.PI / 2 - 0.95, 1.9, 1.05, 0.42);
  visor.scale(0.98, 1.02, 1.1);
  const chin = new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  chin.scale(1, 0.55, 1.15);
  const plate = new THREE.PlaneGeometry(1, 1);
  const shoulder = new THREE.SphereGeometry(0.085, 12, 8);
  return { shoulder, torso, thigh, shin, upperArm, foreArm, glove, boot, stripeLeg, stripeSide, belt, collar, helmet, visor, chin, plate };
})();

/* ------------------------------ textures ------------------------------ */

function helmetTexture(base: string, stripe: string, accent: string, code?: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  // crown stripe front → back (u = 0.25 front, 0.75 back) and a band above the visor
  g.fillStyle = stripe;
  g.fillRect(0, 128 - 52, 512, 18);
  g.fillStyle = accent;
  for (const u of [0.25, 0.75]) g.fillRect(u * 512 - 14, 0, 28, 80);
  g.fillRect(0, 128 - 34, 512, 6);
  if (code) {
    g.font = 'bold 54px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.fillStyle = '#ffffff';
    // centred on the helmet sides: u = 0 (wraps, left side) and u = 0.5 (right side)
    for (const x of [0, 256, 512]) {
      g.strokeText(code.slice(0, 3).toUpperCase(), x, 150);
      g.fillText(code.slice(0, 3).toUpperCase(), x, 150);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function numberTexture(n: number | undefined, fg: string, outline: string) {
  if (n == null) return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 92px Anton, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = outline;
  g.strokeText(String(n), 64, 70);
  g.fillStyle = fg;
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const lum = (hex: string) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/* ------------------------------ component ------------------------------ */

export const DriverFigure = forwardRef<THREE.Group, DriverFigureProps>(function DriverFigure(
  { teamColor = '#D4FF00', accent = '#11151b', livery, number, code, pose = 'stand', ...group },
  ref,
) {
  const liv = resolveLivery(livery, teamColor, accent);
  // ensure the secondary panels contrast with the suit when only one colour is known
  const second = liv.secondary.toLowerCase() === liv.primary.toLowerCase() ? (lum(liv.primary) > 0.35 ? '#15181d' : '#e9edf2') : liv.secondary;
  const numFg = lum(liv.primary) > 0.45 ? '#111418' : '#ffffff';

  const mats = useMemo(() => {
    const suit = new THREE.MeshStandardMaterial({ color: liv.primary, roughness: 0.75, metalness: 0.05 });
    const panel = new THREE.MeshStandardMaterial({ color: second, roughness: 0.7 });
    const acc = new THREE.MeshStandardMaterial({ color: liv.accent, roughness: 0.6 });
    const boots = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.6 });
    const helmetMap = helmetTexture(liv.primary, second, liv.accent, code);
    const helmet = new THREE.MeshStandardMaterial({ map: helmetMap, roughness: 0.22, metalness: 0.25 });
    const visor = new THREE.MeshStandardMaterial({ color: '#0b0f16', roughness: 0.08, metalness: 0.9, emissive: '#1a2a40', emissiveIntensity: 0.25 });
    const numMap = numberTexture(number, numFg, numFg === '#ffffff' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)');
    const num = numMap ? new THREE.MeshStandardMaterial({ map: numMap, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
    return { suit, panel, acc, boots, helmet, visor, num, maps: [helmetMap, numMap] };
  }, [liv.primary, liv.accent, second, code, number, numFg]);

  useEffect(
    () => () => {
      for (const m of [mats.suit, mats.panel, mats.acc, mats.boots, mats.helmet, mats.visor, mats.num]) m?.dispose();
      for (const t of mats.maps) t?.dispose();
    },
    [mats],
  );

  // pose: [shoulderZ, shoulderX, elbowX] per arm (L = +x side, R = -x side)
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null);
  const foreR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    const set = (g: THREE.Group | null, x: number, z: number) => {
      if (g) g.rotation.set(x, 0, z);
    };
    if (pose === 'celebrate') {
      const pump = Math.sin(t * 3.2) * 0.12;
      set(armL.current, 0, 2.55 + pump);
      set(armR.current, 0, -2.55 - pump);
      set(foreL.current, 0, 0.25);
      set(foreR.current, 0, -0.25);
      if (body.current) body.current.position.y = Math.max(0, Math.sin(t * 3.2)) * 0.04;
    } else if (pose === 'wave') {
      set(armL.current, 0.05, 0.14);
      set(foreL.current, -0.12, 0);
      set(armR.current, 0, -2.35);
      set(foreR.current, 0, -0.5 + Math.sin(t * 5) * 0.45);
      if (body.current) body.current.position.y = 0;
    } else {
      const breathe = Math.sin(t * 1.4) * 0.015;
      set(armL.current, 0.06, 0.13 + breathe);
      set(armR.current, 0.06, -0.13 - breathe);
      set(foreL.current, -0.18, 0);
      set(foreR.current, -0.18, 0);
      if (body.current) body.current.position.y = 0;
    }
  });

  const arm = (s: 1 | -1) => (
    <group ref={s > 0 ? armL : armR} position={[s * 0.225, 1.39, 0]}>
      <mesh geometry={G.shoulder} material={mats.suit} castShadow />
      <mesh geometry={G.upperArm} material={mats.suit} castShadow />
      <mesh geometry={G.stripeLeg} material={mats.acc} position={[s * 0.052, -0.15, 0]} scale={[1, 0.36, 0.8]} />
      <group ref={s > 0 ? foreL : foreR} position={[0, -0.3, 0]}>
        <mesh geometry={G.foreArm} material={mats.suit} castShadow />
        <mesh geometry={G.glove} material={mats.panel} castShadow />
      </group>
    </group>
  );

  const leg = (s: 1 | -1) => (
    <group position={[s * 0.1, 0.9, 0]}>
      <mesh geometry={G.thigh} material={mats.suit} castShadow />
      <mesh geometry={G.shin} material={mats.suit} position={[0, -0.42, 0]} castShadow />
      <mesh geometry={G.stripeLeg} material={mats.acc} position={[s * 0.07, -0.42, 0]} />
      <mesh geometry={G.boot} material={mats.boots} position={[0, -0.9, 0]} castShadow />
    </group>
  );

  return (
    <group ref={ref} {...group}>
      <group ref={body}>
        {leg(1)}
        {leg(-1)}
        <mesh geometry={G.torso} material={mats.suit} castShadow />
        <mesh geometry={G.belt} material={mats.panel} position={[0, 0.95, 0]} />
        {[-1, 1].map((s) => (
          <mesh key={s} geometry={G.stripeSide} material={mats.panel} position={[s * 0.165, 1.16, 0]} />
        ))}
        {/* shoulder yoke in accent */}
        <mesh geometry={G.belt} material={mats.acc} position={[0, 1.36, 0]} scale={[1.17, 0.5, 1.15]} />
        {mats.num && (
          <>
            <mesh geometry={G.plate} material={mats.num} position={[0, 1.22, 0.12]} scale={0.15} />
            <mesh geometry={G.plate} material={mats.num} position={[0, 1.24, -0.12]} rotation={[0, Math.PI, 0]} scale={0.2} />
          </>
        )}
        {arm(1)}
        {arm(-1)}
        <mesh geometry={G.collar} material={mats.boots} position={[0, 1.5, 0]} />
        <group position={[0, 1.66, 0.01]}>
          <mesh geometry={G.helmet} material={mats.helmet} castShadow />
          <mesh geometry={G.visor} material={mats.visor} />
          <mesh geometry={G.chin} material={mats.helmet} position={[0, -0.06, 0.03]} />
        </group>
      </group>
    </group>
  );
});
