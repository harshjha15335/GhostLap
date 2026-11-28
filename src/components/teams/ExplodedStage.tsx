import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CAR_PARTS, EXPLODE_VECTORS, F1Car, PART_ANCHORS, easeExplode, type CarPartId } from '@/components/three/F1Car';
import { useCanvasDpr, useInView, useIsMobile } from '@/components/ui/hooks';

/**
 * The ONE <Canvas> of /teams/:teamId: the team's W17 on a blueprint drafting table, split
 * into its 8 sub-assemblies with callout leaders. Upgrade / pace-step rounds pulse the
 * candidate parts in sunshine yellow. Unmounts (disposing its context) with the route.
 */
export const STAGE_BG = '#7A2CFF';
const HIGHLIGHT = '#FFD23F';

export interface ExplodedStageProps {
  teamId: string;
  carColor: string;
  explode: number;
  highlight: CarPartId[];
  onPartHover: (id: CarPartId | null) => void;
  hoveredPart: CarPartId | null;
}

function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const pointer = useThree((s) => s.pointer);
  const look = useRef(new THREE.Vector3(0, 0.9, 0));
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpLook = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    // portrait screens need to pull back
    const k = aspect < 1 ? 1.5 / Math.max(aspect, 0.45) : aspect < 1.4 ? 1.2 : 1;
    tmpPos.set(pointer.x * 0.6, 3.8 + pointer.y * 0.4, 11.5 * Math.min(k, 2.6));
    tmpLook.set(0, aspect < 1 ? -0.7 : 0.9, 0);
    const l = 1 - Math.exp(-2.6 * dt);
    camera.position.lerp(tmpPos, l);
    look.current.lerp(tmpLook, l);
    camera.lookAt(look.current);
  });
  return null;
}

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
  const e = easeExplode(explode);
  const { geom, tags } = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const white = new THREE.Color('#ffffff');
    const hi = new THREE.Color(HIGHLIGHT);
    const tags: { id: CarPartId; at: THREE.Vector3; anchor: THREE.Vector3 }[] = [];
    for (const p of CAR_PARTS) {
      const a = PART_ANCHORS[p.id];
      const v = EXPLODE_VECTORS[p.id];
      const anchor = new THREE.Vector3(a[0] + v[0] * e, a[1] + v[1] * e, a[2] + v[2] * e);
      const o = TAG_OFFSET[p.id];
      const elbow = anchor.clone().add(new THREE.Vector3(o[0] * 0.55, o[1], o[2] * 0.55));
      const tag = anchor.clone().add(new THREE.Vector3(o[0], o[1], o[2]));
      const c = highlight.has(p.id) || hovered === p.id ? hi : white;
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
  const lines = useMemo(() => new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false })), [geom]);
  useEffect(() => () => (lines.material as THREE.Material).dispose(), [lines]);
  const tagOpacity = Math.min(1, Math.max(0, (explode - 0.08) / 0.25));
  return (
    <group>
      <primitive object={lines} />
      {tags.map((t, i) => (
        <mesh key={t.id} position={t.anchor}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshBasicMaterial color={highlight.has(t.id) ? HIGHLIGHT : '#ffffff'} toneMapped={false} />
          {tagOpacity > 0.02 && (
            <Html position={[t.at.x - t.anchor.x, t.at.y - t.anchor.y, t.at.z - t.anchor.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none', opacity: tagOpacity }}>
              <div
                className={`whitespace-nowrap rounded-[4px] border-[1.5px] border-ink px-1.5 py-0.5 font-mono leading-tight text-ink shadow-sticker-sm ${
                  highlight.has(t.id) || hovered === t.id ? 'bg-pop-sun' : 'bg-cream'
                }`}
              >
                <div className="text-[9px] font-bold tracking-wider">
                  {String(i + 1).padStart(2, '0')} · {CAR_PARTS[i].callout.split(' · ')[0]}
                </div>
                {!mobile && <div className="text-[8px] text-ink/70">{CAR_PARTS[i].label}</div>}
              </div>
            </Html>
          )}
        </mesh>
      ))}
    </group>
  );
}

function Exploded({
  teamId,
  carColor,
  explode,
  highlight,
  onPartHover,
  hoveredPart,
  yaw,
  mobile,
}: ExplodedStageProps & { yaw: MutableRefObject<number>; mobile: boolean }) {
  const spin = useRef<THREE.Group>(null);
  const hl = useMemo(() => new Set(highlight), [highlight]);
  useFrame((_, dt) => {
    if (!spin.current) return;
    spin.current.rotation.y = THREE.MathUtils.damp(spin.current.rotation.y, yaw.current, 6, dt);
  });
  return (
    <group>
      {/* blueprint drafting table: white grid on ultraviolet */}
      <gridHelper args={[24, 48, '#B79BFF', '#3A10B0']} position={[0, -1.05, 0]} />
      <mesh position={[0, -1.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6.5, 64]} />
        <meshBasicMaterial color="#5214D1" />
      </mesh>
      <mesh position={[0, -1.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6.4, 6.5, 128]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <group ref={spin}>
        <F1Car teamId={teamId} color={carColor} accent={carColor} explode={explode} highlight={highlight} onPartHover={onPartHover} tyreGlow={0.5} tyreColor="#00F5D4" />
        <Leaders explode={explode} highlight={hl} hovered={hoveredPart} mobile={mobile} />
      </group>
      <spotLight position={[3, 9, 6]} angle={0.6} penumbra={0.6} intensity={140} distance={30} color="#ffffff" />
      <pointLight position={[-6, 3, -4]} intensity={25} color="#cfe0ff" distance={18} />
    </group>
  );
}

export default function ExplodedStage(props: ExplodedStageProps) {
  const dpr = useCanvasDpr();
  const mobile = useIsMobile();
  const [wrapRef, inView] = useInView<HTMLDivElement>();
  const yaw = useRef(-0.75);
  const drag = useRef<{ x: number; yaw: number } | null>(null);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 touch-pan-y"
      onPointerDown={(e) => (drag.current = { x: e.clientX, yaw: yaw.current })}
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
        camera={{ position: [0, 3.8, 11.5], fov: 36, near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => props.onPartHover(null)}
      >
        <color attach="background" args={[STAGE_BG]} />
        <fog attach="fog" args={[STAGE_BG, 22, 48]} />
        <ambientLight intensity={0.7} />
        <hemisphereLight args={['#ffffff', '#3A2BD0', 0.85]} />
        <directionalLight position={[-6, 8, 10]} intensity={1.5} color="#fffaf0" />
        <directionalLight position={[8, 4, -6]} intensity={0.6} color="#ffe9c7" />
        <CameraRig />
        <Suspense fallback={null}>
          <Exploded {...props} yaw={yaw} mobile={mobile} />
        </Suspense>
      </Canvas>
    </div>
  );
}
