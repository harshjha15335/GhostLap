import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MeshReflectorMaterial, SpotLight } from '@react-three/drei';
import { CAR_PARTS, EXPLODE_VECTORS, F1Car, PART_ANCHORS, type CarPartId } from '@/components/three/F1Car';
import { DriverFigure, type DriverPose } from '@/components/three/DriverFigure';
import { LIVERIES } from '@/components/three/liveries';
import { useCanvasDpr, useInView, useIsMobile } from '@/components/ui/hooks';
import { useSeason } from '@/store/seasonStore';
import type { Driver } from '@/types';
import { teamDrivers, type Entity } from './seasonStats';

/**
 * ONE <Canvas> for the whole /season page. Two stages live side by side in
 * world space and the camera rig glides between them:
 *   A) Podium Showroom  — origin
 *   B) Exploded Assembly — x = EXPLODED_X
 */
export type StageId = 'showroom' | 'exploded';
const EXPLODED_X = 70;

export interface SeasonStageProps {
  stage: StageId;
  podium: Entity[];
  selected: Entity | null;
  onSelect: (key: string) => void;
  /** exploded stage */
  carColor: string;
  explode: number;
  highlight: CarPartId[];
  onPartHover: (id: CarPartId | null) => void;
  hoveredPart: CarPartId | null;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function useNumberTexture(text: string, color = '#E8ECF2') {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0b0e14';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(0,245,212,0.35)';
    g.lineWidth = 2;
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = color;
    g.font = '96px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** Critically-under-damped spring for x, driven in useFrame. */
function useSpring(target: number, stiffness = 70, damping = 9) {
  const s = useRef({ x: target, v: 0 });
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 30);
    const a = -stiffness * (s.current.x - target) - damping * s.current.v;
    s.current.v += a * dt;
    s.current.x += s.current.v * dt;
  });
  return s;
}

/* ------------------------------------------------------------------ */
/* Camera rig                                                          */
/* ------------------------------------------------------------------ */

function CameraRig({ stage }: { stage: StageId }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const look = useRef(new THREE.Vector3(0, 1.4, 0));
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpLook = useMemo(() => new THREE.Vector3(), []);
  const pointer = useThree((s) => s.pointer);
  useFrame((_, dt) => {
    // portrait screens need to pull back
    const k = aspect < 1 ? 1.15 / Math.max(aspect, 0.45) : aspect < 1.4 ? 1.2 : 1;
    if (stage === 'showroom') {
      tmpPos.set(pointer.x * 1.2, 7.6 + pointer.y * 0.5, 21 * k);
      tmpLook.set(0, 1.5, 1.5);
    } else {
      const ke = aspect < 1 ? 1.5 / Math.max(aspect, 0.45) : k;
      tmpPos.set(EXPLODED_X + pointer.x * 0.6, 3.8 + pointer.y * 0.4, 11.5 * Math.min(ke, 2.6));
      tmpLook.set(EXPLODED_X, aspect < 1 ? -0.7 : 0.9, 0);
    }
    const l = 1 - Math.exp(-2.6 * dt);
    camera.position.lerp(tmpPos, l);
    look.current.lerp(tmpLook, l);
    camera.lookAt(look.current);
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Stage A — Podium Showroom                                           */
/* ------------------------------------------------------------------ */

const TIERS = [
  { place: 1, x: 0, h: 1.5 },
  { place: 2, x: -6.4, h: 0.95 },
  { place: 3, x: 6.4, h: 0.55 },
];
const TIER_W = 5.6;
const TIER_D = 4.4;

const POSES: Record<number, DriverPose> = { 1: 'celebrate', 2: 'wave', 3: 'stand' };

/** The driver(s) to stand on a tier: the driver in drivers mode, both race drivers in teams mode. */
function usePodiumDrivers(entity?: Entity): Driver[] {
  const season = useSeason();
  return useMemo(() => {
    if (!entity || !season) return [];
    if (entity.mode === 'drivers') return season.drivers.filter((d) => String(d.number) === entity.key);
    return teamDrivers(season, entity.teamId).slice(0, 2);
  }, [entity, season]);
}

function Tier({ place, x, h, entity, selected, onSelect }: { place: number; x: number; h: number; entity?: Entity; selected: boolean; onSelect: (k: string) => void }) {
  const tex = useNumberTexture(String(place), place === 1 ? '#D4FF00' : '#E8ECF2');
  const car = useRef<THREE.Group>(null);
  const [target] = useState(() => new THREE.Object3D());
  const drivers = usePodiumDrivers(entity);
  const side = place === 2 ? -1 : 1;
  // the car sits angled at the back of the tier and sways gently; drivers stand in front of it
  const baseYaw = side * (Math.PI / 2 - 0.55);
  useFrame(({ clock }) => {
    if (car.current) car.current.rotation.y = baseYaw + Math.sin(clock.elapsedTime * 0.45 + place) * 0.22;
  });
  return (
    <group position={[x, 0, 0]}>
      {/* metal body */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[TIER_W, h, TIER_D]} />
        <meshStandardMaterial color="#10141b" metalness={0.85} roughness={0.28} />
      </mesh>
      {/* illuminated glass top */}
      <mesh position={[0, h + 0.06, 0]}>
        <boxGeometry args={[TIER_W + 0.12, 0.12, TIER_D + 0.12]} />
        <meshPhysicalMaterial color="#9fe9ff" transparent opacity={0.22} roughness={0.08} metalness={0.1} emissive="#00F5D4" emissiveIntensity={selected ? 0.55 : 0.18} />
      </mesh>
      {/* edge light strip */}
      <mesh position={[0, h + 0.005, TIER_D / 2 + 0.07]}>
        <boxGeometry args={[TIER_W + 0.1, 0.03, 0.03]} />
        <meshBasicMaterial color={selected ? '#00F5D4' : place === 1 ? '#D4FF00' : '#5b6676'} toneMapped={false} />
      </mesh>
      {/* number plinth face */}
      <mesh position={[0, h / 2, TIER_D / 2 + 0.005]}>
        <planeGeometry args={[Math.min(1.6, h * 1.6), Math.min(0.8, h * 0.8)]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {entity && (
        <group
          position={[0, h + 0.12, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(entity.key);
          }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = '')}
        >
          <group ref={car} position={[0, 0, -0.75]} scale={0.74}>
            <F1Car teamId={entity.teamId} color={entity.color} accent={entity.color} number={entity.number} tyreGlow={0.4} tyreColor="#D4FF00" />
          </group>
          {drivers.map((d, i) => (
            <DriverFigure
              key={d.number}
              livery={LIVERIES[d.teamId] ? d.teamId : undefined}
              teamColor={d.color}
              accent={entity.color}
              number={d.number}
              code={d.code}
              pose={POSES[place] ?? 'stand'}
              position={[drivers.length > 1 ? (i ? 0.95 : -0.95) : side * 0.6, 0, 1.25]}
              rotation={[0, drivers.length > 1 ? (i ? -0.2 : 0.2) : -side * 0.15, 0]}
              scale={0.86}
            />
          ))}
        </group>
      )}
      {entity && (
        <Html position={[0, h + 2.45, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap text-center font-mono leading-tight">
            <div className="text-[11px] font-semibold text-white" style={{ textShadow: '0 1px 6px #000' }}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: entity.color }} />
              {entity.label}
            </div>
            <div className="text-[9px] tracking-widest text-white/60">{entity.points} PTS</div>
          </div>
        </Html>
      )}
      <primitive object={target} position={[0, h, 0]} />
      <SpotLight
        position={[0, 10.5, 1.2]}
        target={target}
        angle={0.36}
        penumbra={0.55}
        intensity={place === 1 ? 90 : 55}
        distance={16}
        attenuation={9.5}
        anglePower={4.5}
        radiusTop={0.25}
        radiusBottom={3.2}
        opacity={place === 1 ? 0.32 : 0.2}
        color={place === 1 ? '#f4ffd0' : '#dff7ff'}
      />
    </group>
  );
}

/** Centre-spotlight turntable in front of the podium: the selected entity springs in here. */
function HeroTurntable({ entity }: { entity: Entity | null }) {
  const group = useRef<THREE.Group>(null);
  const car = useRef<THREE.Group>(null);
  const [shown, setShown] = useState(entity);
  const [dir, setDir] = useState(1);
  const spring = useSpring(0, 55, 8.5);
  const target = useMemo(() => new THREE.Object3D(), []);
  // when the selection changes: start off-stage, then spring into the centre
  useEffect(() => {
    if (entity?.key === shown?.key) return;
    const d = Math.random() > 0.5 ? 1 : -1;
    setDir(d);
    setShown(entity);
    spring.current.x = 1;
    spring.current.v = 0;
  }, [entity, shown, spring]);
  useFrame((_, dt) => {
    const x = spring.current.x;
    if (group.current) {
      group.current.position.x = x * 14 * dir;
      group.current.rotation.y = x * 1.4 * dir;
    }
    if (car.current) car.current.rotation.y += dt * 0.35;
  });
  return (
    <group position={[0, 0, 5.6]} scale={0.82}>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[3.1, 3.25, 0.08, 64]} />
        <meshPhysicalMaterial color="#0e131b" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.95, 3.05, 96]} />
        <meshBasicMaterial color={shown?.color ?? '#00F5D4'} toneMapped={false} />
      </mesh>
      <group ref={group}>
        <group ref={car} position={[0, 0.09, 0]}>
          {shown && <F1Car teamId={shown.teamId} color={shown.color} accent={shown.color} number={shown.number} tyreGlow={0.7} tyreColor="#00F5D4" />}
        </group>
      </group>
      <primitive object={target} position={[0, 0, 0]} />
      <SpotLight
        position={[0, 9, 0.5]}
        target={target}
        angle={0.38}
        penumbra={0.5}
        intensity={70}
        distance={14}
        attenuation={8}
        anglePower={5}
        radiusTop={0.2}
        radiusBottom={3.4}
        opacity={0.22}
        color="#c9fff6"
      />
    </group>
  );
}

function Showroom({ podium, selected, onSelect, mobile }: Pick<SeasonStageProps, 'podium' | 'selected' | 'onSelect'> & { mobile: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[80, 60]} />
        {mobile ? (
          <meshStandardMaterial color="#07090d" metalness={0.6} roughness={0.5} />
        ) : (
          <MeshReflectorMaterial
            resolution={512}
            mirror={0.45}
            blur={[260, 80]}
            mixBlur={1}
            mixStrength={2.2}
            depthScale={0.6}
            minDepthThreshold={0.6}
            maxDepthThreshold={1.2}
            color="#07090d"
            metalness={0.6}
            roughness={0.75}
          />
        )}
      </mesh>
      {/* back wall light slits */}
      {[-12, -6, 0, 6, 12].map((x) => (
        <mesh key={x} position={[x, 5, -9]}>
          <planeGeometry args={[0.06, 10]} />
          <meshBasicMaterial color="#1d2735" toneMapped={false} />
        </mesh>
      ))}
      {TIERS.map((t, i) => (
        <Tier key={t.place} {...t} entity={podium[i]} selected={!!selected && podium[i]?.key === selected.key} onSelect={onSelect} />
      ))}
      <HeroTurntable entity={selected} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Stage B — Exploded Assembly                                         */
/* ------------------------------------------------------------------ */

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); // matches F1Car

/** where each callout tag sits relative to its (exploded) anchor */
const TAG_OFFSET: Record<CarPartId, [number, number, number]> = {
  frontWing: [1.5, 0.55, 0.5],
  monocoque: [-1.7, 1.15, 0.6],
  floor: [-1.9, -0.35, 0.4],
  sidepods: [1.4, 0.35, 0.1],
  ice: [-1.5, 0.55, -0.2],
  ers: [1.6, 0.75, -0.2],
  gearbox: [-1.4, 0.25, -0.6],
  rearWing: [1.4, 0.55, -0.5],
};

function Leaders({ explode, highlight, hovered, mobile }: { explode: number; highlight: Set<CarPartId>; hovered: CarPartId | null; mobile: boolean }) {
  const e = ease(explode);
  const { geom, tags } = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const white = new THREE.Color('#d8e2ee');
    const cyan = new THREE.Color('#00F5D4');
    const tags: { id: CarPartId; at: THREE.Vector3; anchor: THREE.Vector3 }[] = [];
    for (const p of CAR_PARTS) {
      const a = PART_ANCHORS[p.id];
      const v = EXPLODE_VECTORS[p.id];
      const anchor = new THREE.Vector3(a[0] + v[0] * e, a[1] + v[1] * e, a[2] + v[2] * e);
      const o = TAG_OFFSET[p.id];
      const elbow = anchor.clone().add(new THREE.Vector3(o[0] * 0.55, o[1], o[2] * 0.55));
      const tag = anchor.clone().add(new THREE.Vector3(o[0], o[1], o[2]));
      const c = highlight.has(p.id) || hovered === p.id ? cyan : white;
      pos.push(anchor.x, anchor.y, anchor.z, elbow.x, elbow.y, elbow.z, elbow.x, elbow.y, elbow.z, tag.x, tag.y, tag.z);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      tags.push({ id: p.id, at: tag, anchor });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return { geom: g, tags };
  }, [e, highlight, hovered]);
  useEffect(() => () => geom.dispose(), [geom]);
  const lines = useMemo(() => new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, toneMapped: false })), [geom]);
  useEffect(() => () => (lines.material as THREE.Material).dispose(), [lines]);
  const tagOpacity = Math.min(1, Math.max(0, (explode - 0.08) / 0.25));
  return (
    <group>
      <primitive object={lines} />
      {tags.map((t, i) => (
        <mesh key={t.id} position={t.anchor}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshBasicMaterial color={highlight.has(t.id) ? '#00F5D4' : '#ffffff'} toneMapped={false} />
          {tagOpacity > 0.02 && (
            <Html position={[t.at.x - t.anchor.x, t.at.y - t.anchor.y, t.at.z - t.anchor.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none', opacity: tagOpacity }}>
              <div
                className={`whitespace-nowrap border px-1.5 py-0.5 font-mono leading-tight backdrop-blur-sm ${
                  highlight.has(t.id) || hovered === t.id ? 'border-ghost bg-ghost/15 text-ghost' : 'border-white/30 bg-asphalt/70 text-white/85'
                }`}
              >
                <div className="text-[9px] font-semibold tracking-wider">
                  {String(i + 1).padStart(2, '0')} · {CAR_PARTS[i].callout.split(' · ')[0]}
                </div>
                {!mobile && <div className="text-[8px] text-white/55">{CAR_PARTS[i].label}</div>}
              </div>
            </Html>
          )}
        </mesh>
      ))}
    </group>
  );
}

function Exploded({
  carColor,
  explode,
  highlight,
  onPartHover,
  hoveredPart,
  yaw,
  mobile,
  teamId,
}: Pick<SeasonStageProps, 'carColor' | 'explode' | 'highlight' | 'onPartHover' | 'hoveredPart'> & { yaw: MutableRefObject<number>; mobile: boolean; teamId?: string }) {
  const spin = useRef<THREE.Group>(null);
  const hl = useMemo(() => new Set(highlight), [highlight]);
  useFrame((_, dt) => {
    if (!spin.current) return;
    spin.current.rotation.y = THREE.MathUtils.damp(spin.current.rotation.y, yaw.current, 6, dt);
  });
  return (
    <group position={[EXPLODED_X, 0, 0]}>
      {/* blueprint floor */}
      <gridHelper args={[24, 48, '#1f6f68', '#122029']} position={[0, -1.05, 0]} />
      <mesh position={[0, -1.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6.5, 64]} />
        <meshBasicMaterial color="#0a1018" />
      </mesh>
      <mesh position={[0, -1.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6.4, 6.46, 128]} />
        <meshBasicMaterial color="#00F5D4" transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <group ref={spin} position={[0, 0, 0]}>
        <F1Car teamId={teamId} color={carColor} accent={carColor} explode={explode} highlight={highlight} onPartHover={onPartHover} tyreGlow={0.5} tyreColor="#00F5D4" />
        <Leaders explode={explode} highlight={hl} hovered={hoveredPart} mobile={mobile} />
      </group>
      <spotLight position={[3, 9, 6]} angle={0.6} penumbra={0.6} intensity={140} distance={30} color="#eaf6ff" />
      <pointLight position={[-6, 3, -4]} intensity={25} color="#00F5D4" distance={18} />
    </group>
  );
}

/* ------------------------------------------------------------------ */

function StageVisibility({ stage, children }: { stage: StageId; children: [JSX.Element, JSX.Element] }) {
  // hide the far stage once the camera has arrived (saves draw calls)
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const x = camera.position.x;
    if (a.current) a.current.visible = x < EXPLODED_X - 8 || stage === 'showroom';
    if (b.current) b.current.visible = x > 8 || stage === 'exploded';
  });
  return (
    <>
      <group ref={a}>{children[0]}</group>
      <group ref={b}>{children[1]}</group>
    </>
  );
}

export default function SeasonStage(props: SeasonStageProps) {
  const dpr = useCanvasDpr();
  const mobile = useIsMobile();
  const [wrapRef, inView] = useInView<HTMLDivElement>();
  const yaw = useRef(-0.75);
  const drag = useRef<{ x: number; yaw: number } | null>(null);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 touch-pan-y"
      onPointerDown={(e) => {
        if (props.stage !== 'exploded') return;
        drag.current = { x: e.clientX, yaw: yaw.current };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        yaw.current = drag.current.yaw + (e.clientX - drag.current.x) * 0.01;
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <Canvas
        dpr={dpr}
        frameloop={inView ? 'always' : 'never'}
        camera={{ position: [0, 7.6, 21], fov: 36, near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => props.onPartHover(null)}
      >
        <color attach="background" args={['#06080c']} />
        <fog attach="fog" args={['#06080c', 22, 48]} />
        <ambientLight intensity={0.45} />
        <hemisphereLight args={['#9fb7d6', '#05070a', 0.5]} />
        <directionalLight position={[-6, 8, 10]} intensity={1.3} />
        <directionalLight position={[8, 4, -6]} intensity={0.5} color="#00F5D4" />
        <CameraRig stage={props.stage} />
        <Suspense fallback={null}>
          <StageVisibility stage={props.stage}>
            <Showroom podium={props.podium} selected={props.selected} onSelect={props.onSelect} mobile={mobile} />
            <Exploded
              carColor={props.carColor}
              explode={props.explode}
              highlight={props.highlight}
              onPartHover={props.onPartHover}
              hoveredPart={props.hoveredPart}
              yaw={yaw}
              mobile={mobile}
              teamId={props.selected?.teamId}
            />
          </StageVisibility>
        </Suspense>
      </Canvas>
    </div>
  );
}
