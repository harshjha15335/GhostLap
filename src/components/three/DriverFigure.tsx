import { forwardRef, useEffect, useMemo, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { resolveLivery, type Livery } from './liveries';

/**
 * Human-proportioned standing race driver (helmet with visor, team-coloured race suit,
 * gloves, boots, race harness, and chest/back number).
 *
 * Proportions: athletic 1.78 m tall (head/helmet ~1/7.5 of height, broad shoulders,
 * tapered waist, articulated limbs).
 *
 * Props:
 *   teamColor / accent   suit colours (fallback when no `livery`)
 *   livery               same livery object / teamId as F1Car (primary suit, secondary panels, accent stripes)
 *   number               car number on chest and back
 *   code                 optional initials painted on the helmet sides
 *   pose                 'stand' | 'celebrate' (both arms up, P1) | 'wave'
 *   useModel             optional flag to toggle between GLB driver model and procedural figure (defaults to true)
 */
export type DriverPose = 'stand' | 'celebrate' | 'wave';

export type DriverFigureProps = ThreeElements['group'] & {
  teamColor?: string;
  accent?: string;
  livery?: Livery | string;
  number?: number;
  code?: string;
  pose?: DriverPose;
  useModel?: boolean;
};

/* ------------------------------ shared geometry ------------------------------ */

const G = (() => {
  const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 12);

  // Anatomical torso: athletic V-taper from hips to broad shoulders
  const prof = [
    [0.0, 0.85],
    [0.155, 0.86], // hips
    [0.165, 0.96], // pelvis
    [0.15, 1.08],  // waist
    [0.18, 1.25],  // chest lower
    [0.21, 1.38],  // chest broad
    [0.185, 1.47], // shoulder slope
    [0.075, 1.51], // neck base
    [0.0, 1.51],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(prof, 20);
  torso.scale(1, 1, 0.65);

  // Limbs with anatomical taper
  const thigh = cap(0.088, 0.35);
  thigh.translate(0, -0.22, 0);

  const shin = cap(0.072, 0.36);
  shin.translate(0, -0.22, 0);

  const upperArm = cap(0.062, 0.20);
  upperArm.translate(0, -0.15, 0);

  const foreArm = cap(0.054, 0.18);
  foreArm.translate(0, -0.14, 0);

  // Ergonomic racing glove with thumb
  const glovePalm = new THREE.SphereGeometry(0.062, 12, 10);
  glovePalm.scale(0.85, 1.15, 0.85);
  glovePalm.translate(0, -0.29, 0);

  // Racing boot with sole & heel
  const bootFoot = new THREE.BoxGeometry(0.09, 0.08, 0.22);
  bootFoot.translate(0, 0.045, 0.04);
  const bootAnkle = cap(0.065, 0.12);
  bootAnkle.translate(0, 0.1, 0);

  // Suit stripes & harness
  const stripeLeg = new THREE.BoxGeometry(0.016, 0.82, 0.05);
  const stripeSide = new THREE.BoxGeometry(0.02, 0.44, 0.12);
  const belt = new THREE.CylinderGeometry(0.165, 0.165, 0.055, 20, 1, true);
  belt.scale(1, 1, 0.67);

  // Collar & HANS device padding
  const collar = new THREE.CylinderGeometry(0.075, 0.095, 0.08, 16);

  // F1 Helmet: sculpted aerodynamic shell with chin bar and rear spoiler
  const helmet = new THREE.SphereGeometry(0.148, 28, 20);
  helmet.scale(0.96, 1.04, 1.1);

  // Helmet aerodynamic rear ducktail spoiler
  const spoiler = new THREE.BoxGeometry(0.18, 0.03, 0.06);
  spoiler.translate(0, 0.06, -0.14);

  // Sculpted visor with aerodynamic curve
  const visor = new THREE.SphereGeometry(0.152, 22, 8, Math.PI / 2 - 0.95, 1.9, 1.02, 0.44);
  visor.scale(0.96, 1.04, 1.1);

  // Chin spoiler / mouth vent
  const chin = new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  chin.scale(0.95, 0.55, 1.15);

  const plate = new THREE.PlaneGeometry(1, 1);
  const shoulder = new THREE.SphereGeometry(0.082, 14, 10);

  return {
    shoulder,
    torso,
    thigh,
    shin,
    upperArm,
    foreArm,
    glovePalm,
    bootFoot,
    bootAnkle,
    stripeLeg,
    stripeSide,
    belt,
    collar,
    helmet,
    spoiler,
    visor,
    chin,
    plate,
  };
})();

/* ------------------------------ textures ------------------------------ */

function helmetTexture(base: string, stripe: string, accent: string, code?: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);

  // Crown stripe front → back (u = 0.25 front, 0.75 back) and band above visor
  g.fillStyle = stripe;
  g.fillRect(0, 128 - 52, 512, 20);

  g.fillStyle = accent;
  for (const u of [0.25, 0.75]) {
    g.fillRect(u * 512 - 14, 0, 28, 86);
  }
  g.fillRect(0, 128 - 32, 512, 8);

  // Driver code on helmet flanks
  if (code) {
    g.font = 'bold 54px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.fillStyle = '#ffffff';
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

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('Driver GLB model load failed, falling back to procedural:', error, errorInfo);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function DriverGlbModel({
  liv,
  second,
  number,
  numFg,
  pose,
}: {
  liv: Livery;
  second: string;
  number?: number;
  numFg: string;
  pose?: DriverPose;
}) {
  const { scene } = useGLTF('/models/driver.glb');

  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mat) return;

        const matName = mat.name;
        if (matName === 'RT_DriverSuit') {
          const m = mat.clone();
          m.color.set(liv.primary);
          m.roughness = 0.68;
          m.metalness = 0.08;
          mesh.material = m;
        } else if (matName === 'RT_Helemt') {
          const m = mat.clone();
          m.color.set(second);
          m.roughness = 0.28;
          m.metalness = 0.32;
          mesh.material = m;
        } else if (matName === 'RT_HELMET_Glass') {
          const m = mat.clone();
          m.color.set('#0b0e14');
          m.roughness = 0.06;
          m.metalness = 0.94;
          mesh.material = m;
        } else if (matName === 'RT_Gloves') {
          const m = mat.clone();
          m.color.set(liv.accent || second);
          m.roughness = 0.6;
          mesh.material = m;
        } else if (matName === 'RT_HANS') {
          const m = mat.clone();
          m.color.set('#1c1e22');
          m.roughness = 0.5;
          mesh.material = m;
        }
      }
    });
    return clone;
  }, [scene, liv.primary, liv.accent, second]);

  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const rootRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (rootRef.current) {
      if (pose === 'celebrate') {
        const pump = Math.sin(t * 3.4) * 0.035;
        rootRef.current.position.y = 2.22435 + Math.max(0, pump);
      } else if (pose === 'wave') {
        const shift = Math.sin(t * 2.0) * 0.008;
        rootRef.current.position.y = 2.22435 + shift;
      } else {
        const breathe = Math.sin(t * 1.5) * 0.005;
        rootRef.current.position.y = 2.22435 + breathe;
      }
    }
  });

  const numMap = useMemo(
    () => (number != null ? numberTexture(number, numFg, numFg === '#ffffff' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.5)') : null),
    [number, numFg]
  );

  const numMat = useMemo(
    () =>
      numMap
        ? new THREE.MeshStandardMaterial({
            map: numMap,
            transparent: true,
            roughness: 0.7,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          })
        : null,
    [numMap]
  );

  useEffect(() => () => {
    numMap?.dispose();
    numMat?.dispose();
  }, [numMap, numMat]);

  return (
    <group scale={0.40958}>
      <group ref={rootRef} position={[0, 2.22435, -0.2537]}>
        <primitive object={model} />
        {numMat && (
          <>
            <mesh geometry={G.plate} material={numMat} position={[0, 0.72, 0.38]} scale={0.38} />
            <mesh geometry={G.plate} material={numMat} position={[0, 0.75, -0.06]} rotation={[0, Math.PI, 0]} scale={0.48} />
          </>
        )}
      </group>
    </group>
  );
}

if (typeof window !== 'undefined') {
  useGLTF.preload('/models/driver.glb');
}

/* ------------------------------ component ------------------------------ */

export const DriverFigure = forwardRef<THREE.Group, DriverFigureProps>(function DriverFigure(
  { teamColor = '#D4FF00', accent = '#11151b', livery, number, code, pose = 'stand', useModel = true, ...group },
  ref,
) {
  const liv = resolveLivery(livery, teamColor, accent);
  const second =
    liv.secondary.toLowerCase() === liv.primary.toLowerCase()
      ? lum(liv.primary) > 0.35
        ? '#15181d'
        : '#e9edf2'
      : liv.secondary;
  const numFg = lum(liv.primary) > 0.45 ? '#111418' : '#ffffff';

  const mats = useMemo(() => {
    const suit = new THREE.MeshStandardMaterial({ color: liv.primary, roughness: 0.72, metalness: 0.05 });
    const panel = new THREE.MeshStandardMaterial({ color: second, roughness: 0.68 });
    const acc = new THREE.MeshStandardMaterial({ color: liv.accent, roughness: 0.55 });
    const boots = new THREE.MeshStandardMaterial({ color: '#14161a', roughness: 0.6 });
    const helmetMap = helmetTexture(liv.primary, second, liv.accent, code);
    const helmet = new THREE.MeshStandardMaterial({ map: helmetMap, roughness: 0.22, metalness: 0.25 });
    const visor = new THREE.MeshStandardMaterial({
      color: '#080c14',
      roughness: 0.06,
      metalness: 0.92,
      emissive: '#162438',
      emissiveIntensity: 0.28,
    });
    const numMap = numberTexture(number, numFg, numFg === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.45)');
    const num = numMap
      ? new THREE.MeshStandardMaterial({
          map: numMap,
          transparent: true,
          roughness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        })
      : null;
    return { suit, panel, acc, boots, helmet, visor, num, maps: [helmetMap, numMap] };
  }, [liv.primary, liv.accent, second, code, number, numFg]);

  useEffect(
    () => () => {
      for (const m of [mats.suit, mats.panel, mats.acc, mats.boots, mats.helmet, mats.visor, mats.num]) m?.dispose();
      for (const t of mats.maps) t?.dispose();
    },
    [mats],
  );

  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null);
  const foreR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    const set = (g: THREE.Group | null, x: number, z: number) => {
      if (g) g.rotation.set(x, 0, z);
    };

    if (pose === 'celebrate') {
      const pump = Math.sin(t * 3.4) * 0.12;
      set(armL.current, 0, 2.58 + pump);
      set(armR.current, 0, -2.58 - pump);
      set(foreL.current, 0, 0.26);
      set(foreR.current, 0, -0.26);
      if (body.current) body.current.position.y = Math.max(0, Math.sin(t * 3.4)) * 0.045;
      if (head.current) head.current.rotation.x = -0.15; // looking up triumphantly
    } else if (pose === 'wave') {
      set(armL.current, 0.05, 0.14);
      set(foreL.current, -0.12, 0);
      set(armR.current, 0, -2.35);
      set(foreR.current, 0, -0.5 + Math.sin(t * 5.2) * 0.45);
      if (body.current) body.current.position.y = 0;
      if (head.current) head.current.rotation.x = 0;
    } else {
      const breathe = Math.sin(t * 1.5) * 0.015;
      set(armL.current, 0.06, 0.13 + breathe);
      set(armR.current, 0.06, -0.13 - breathe);
      set(foreL.current, -0.18, 0);
      set(foreR.current, -0.18, 0);
      if (body.current) body.current.position.y = 0;
      if (head.current) head.current.rotation.x = 0;
    }
  });

  const arm = (s: 1 | -1) => (
    <group ref={s > 0 ? armL : armR} position={[s * 0.225, 1.39, 0]}>
      <mesh geometry={G.shoulder} material={mats.suit} castShadow />
      <mesh geometry={G.upperArm} material={mats.suit} castShadow />
      <mesh geometry={G.stripeLeg} material={mats.acc} position={[s * 0.052, -0.15, 0]} scale={[1, 0.36, 0.8]} />
      <group ref={s > 0 ? foreL : foreR} position={[0, -0.3, 0]}>
        <mesh geometry={G.foreArm} material={mats.suit} castShadow />
        <mesh geometry={G.glovePalm} material={mats.panel} castShadow />
      </group>
    </group>
  );

  const leg = (s: 1 | -1) => (
    <group position={[s * 0.1, 0.9, 0]}>
      <mesh geometry={G.thigh} material={mats.suit} castShadow />
      <mesh geometry={G.shin} material={mats.suit} position={[0, -0.42, 0]} castShadow />
      <mesh geometry={G.stripeLeg} material={mats.acc} position={[s * 0.07, -0.42, 0]} />
      <group position={[0, -0.9, 0]}>
        <mesh geometry={G.bootAnkle} material={mats.boots} castShadow />
        <mesh geometry={G.bootFoot} material={mats.boots} castShadow />
      </group>
    </group>
  );

  const proceduralDriver = (
    <group ref={body}>
      {leg(1)}
      {leg(-1)}
      <mesh geometry={G.torso} material={mats.suit} castShadow />
      <mesh geometry={G.belt} material={mats.panel} position={[0, 0.95, 0]} />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={G.stripeSide} material={mats.panel} position={[s * 0.165, 1.16, 0]} />
      ))}
      {/* shoulder harness yoke in accent */}
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
      <group ref={head} position={[0, 1.66, 0.01]}>
        <mesh geometry={G.helmet} material={mats.helmet} castShadow />
        <mesh geometry={G.spoiler} material={mats.helmet} />
        <mesh geometry={G.visor} material={mats.visor} />
        <mesh geometry={G.chin} material={mats.helmet} position={[0, -0.06, 0.03]} />
      </group>
    </group>
  );

  return (
    <group ref={ref} {...group}>
      {useModel ? (
        <ModelErrorBoundary fallback={proceduralDriver}>
          <DriverGlbModel liv={liv} second={second} number={number} numFg={numFg} pose={pose} />
        </ModelErrorBoundary>
      ) : (
        proceduralDriver
      )}
    </group>
  );
});
