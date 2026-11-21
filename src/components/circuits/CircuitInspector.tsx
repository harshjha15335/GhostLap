import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { CircuitGeometry } from '@/types';
import { createCircuitCurve } from '@/engine/circuitCurve';
import { useCanvasDpr, useInView } from '@/components/ui/hooks';
import { SECTOR_COLORS } from './TrackOutline';

/** Elevation exaggeration on top of what the data pipeline already applies. */
const ELEV = 1;
const HALF_WIDTH = 2.2;
const SAMPLES = 720;
const KERB_THRESHOLD = 0.12; // rad of heading change across a 4-sample window ≈ high-curvature apex

interface TrackMeshes {
  ribbon: THREE.BufferGeometry;
  skirt: THREE.BufferGeometry;
  centre: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  kerbs: { pos: THREE.Vector3; yaw: number; red: boolean }[];
  start: { pos: THREE.Vector3; yaw: number };
  curve: THREE.CatmullRomCurve3;
}

function buildTrack(circuit: CircuitGeometry): TrackMeshes {
  const cc = createCircuitCurve(circuit);
  const [s1, s2] = circuit.sectorSplits;
  const up = new THREE.Vector3(0, 1, 0);
  const pts: THREE.Vector3[] = [];
  const tans: THREE.Vector3[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / SAMPLES;
    const p = cc.pointAt(f);
    p.y *= ELEV;
    pts.push(p);
    tans.push(cc.tangentAt(f).setY(0).normalize());
  }
  const sectorOf = (f: number) => (f < s1 ? 0 : f < s2 ? 1 : 2);
  const colors = SECTOR_COLORS.map((c) => new THREE.Color(c));
  const asphalt = new THREE.Color('#1a1f29');

  const rPos: number[] = [], rCol: number[] = [], rIdx: number[] = [];
  const sPos: number[] = [], sIdx: number[] = [];
  const cPos: number[] = [], cCol: number[] = [];
  const ePos: number[] = [];
  const sides: THREE.Vector3[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const k = i % SAMPLES;
    const p = pts[k];
    const side = new THREE.Vector3().crossVectors(tans[k], up).normalize();
    sides.push(side);
    const l = p.clone().addScaledVector(side, HALF_WIDTH);
    const r = p.clone().addScaledVector(side, -HALF_WIDTH);
    const col = asphalt.clone().lerp(colors[sectorOf(i / SAMPLES)], 0.16);
    rPos.push(l.x, l.y + 0.02, l.z, r.x, r.y + 0.02, r.z);
    rCol.push(col.r, col.g, col.b, col.r, col.g, col.b);
    sPos.push(l.x, l.y, l.z, l.x, -0.6, l.z, r.x, r.y, r.z, r.x, -0.6, r.z);
    const cc2 = colors[sectorOf(i / SAMPLES)];
    cPos.push(p.x, p.y + 0.06, p.z);
    cCol.push(cc2.r, cc2.g, cc2.b);
    if (i > 0) {
      const a = (i - 1) * 2;
      rIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      const b = (i - 1) * 4;
      sIdx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4, b + 2, b + 6, b + 3, b + 3, b + 6, b + 7);
      const pl = (i - 1) * 6;
      ePos.push(rPos[pl], rPos[pl + 1] + 0.02, rPos[pl + 2], l.x, l.y + 0.04, l.z);
      ePos.push(rPos[pl + 3], rPos[pl + 4] + 0.02, rPos[pl + 5], r.x, r.y + 0.04, r.z);
    }
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  ribbon.setAttribute('color', new THREE.Float32BufferAttribute(rCol, 3));
  ribbon.setIndex(rIdx);
  ribbon.computeVertexNormals();
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  skirt.setIndex(sIdx);
  skirt.computeVertexNormals();
  const centre = new THREE.BufferGeometry();
  centre.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  centre.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3));

  // apex kerbs: heading change over a ±2 sample window, placed on the inside of the corner
  const kerbs: TrackMeshes['kerbs'] = [];
  let stripe = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const a = tans[(i - 2 + SAMPLES) % SAMPLES];
    const b = tans[(i + 2) % SAMPLES];
    const turn = Math.atan2(a.x * b.z - a.z * b.x, a.dot(b)); // signed yaw change
    if (Math.abs(turn) < KERB_THRESHOLD) continue;
    // turn > 0 ⇔ heading rotates toward +side, so +side is the inside of the corner
    const inner = Math.sign(turn);
    const pos = pts[i].clone().addScaledVector(sides[i], inner * (HALF_WIDTH + 0.35));
    pos.y += 0.05;
    kerbs.push({ pos, yaw: Math.atan2(tans[i].x, tans[i].z), red: stripe++ % 2 === 0 });
  }

  return {
    ribbon,
    skirt,
    centre,
    edges,
    kerbs,
    start: { pos: pts[0].clone(), yaw: Math.atan2(tans[0].x, tans[0].z) },
    curve: cc.curve,
  };
}

function useChequer() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const g = c.getContext('2d')!;
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * 4, y * 4, 4, 4);
      }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function Kerbs({ kerbs }: { kerbs: TrackMeshes['kerbs'] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const red = new THREE.Color('#FF1E1E');
    const white = new THREE.Color('#F2F2F2');
    kerbs.forEach((k, i) => {
      o.position.copy(k.pos);
      o.rotation.set(0, k.yaw, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, k.red ? red : white);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [kerbs]);
  if (!kerbs.length) return null;
  return (
    <instancedMesh key={kerbs.length} ref={ref} args={[undefined, undefined, kerbs.length]}>
      <boxGeometry args={[0.7, 0.12, 0.62]} />
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}

function Gantry({ pos, yaw }: { pos: THREE.Vector3; yaw: number }) {
  const tex = useChequer();
  const span = HALF_WIDTH * 2 + 2.4;
  return (
    <group position={pos} rotation={[0, yaw, 0]} scale={[1, 1.6, 1]}>
      {/* chequered start/finish line painted on the ribbon */}
      <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[HALF_WIDTH * 2, 0.9]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * span) / 2, 2.4, 0]}>
          <boxGeometry args={[0.25, 4.8, 0.25]} />
          <meshStandardMaterial color="#2a313d" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0, 4.9, 0]}>
        <boxGeometry args={[span + 0.25, 0.7, 0.3]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, 4.4, 0.16]}>
        <boxGeometry args={[span * 0.5, 0.12, 0.02]} />
        <meshBasicMaterial color="#D4FF00" toneMapped={false} />
      </mesh>
    </group>
  );
}

function GhostRunner({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    curve.getPointAt((clock.elapsedTime * 0.035) % 1, tmp);
    ref.current.position.set(tmp.x, tmp.y * ELEV + 0.6, tmp.z);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.9, 16, 12]} />
      <meshBasicMaterial color="#00F5D4" toneMapped={false} />
    </mesh>
  );
}

function Track({ circuit }: { circuit: CircuitGeometry }) {
  const t = useMemo(() => buildTrack(circuit), [circuit]);
  useEffect(
    () => () => {
      t.ribbon.dispose();
      t.skirt.dispose();
      t.centre.dispose();
      t.edges.dispose();
    },
    [t],
  );
  const centreLine = useMemo(() => {
    const l = new THREE.LineLoop(t.centre, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }));
    return l;
  }, [t]);
  const edgeLines = useMemo(
    () => new THREE.LineSegments(t.edges, new THREE.LineBasicMaterial({ color: '#cfd6e0', transparent: true, opacity: 0.45 })),
    [t],
  );
  useEffect(
    () => () => {
      (centreLine.material as THREE.Material).dispose();
      (edgeLines.material as THREE.Material).dispose();
    },
    [centreLine, edgeLines],
  );
  return (
    <group>
      <mesh geometry={t.ribbon} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={t.skirt}>
        <meshStandardMaterial color="#0d1118" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <primitive object={centreLine} />
      <primitive object={edgeLines} />
      <Kerbs kerbs={t.kerbs} />
      <Gantry pos={t.start.pos} yaw={t.start.yaw} />
      <GhostRunner curve={t.curve} />
    </group>
  );
}

/** Frames the ±100-unit circuit for the current aspect ratio (portrait phones need a longer lens). */
function CameraFit() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(210 / (2 * half * aspect), 180 / (2 * half)) * 0.95;
    camera.position.set(0, dist * 0.62, dist * 0.78);
    camera.lookAt(0, 0, 0);
  }, [camera, aspect]);
  return null;
}

export default function CircuitInspector({ circuit }: { circuit: CircuitGeometry | null }) {
  const dpr = useCanvasDpr();
  const [wrapRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Canvas
        dpr={dpr}
        frameloop={inView ? 'always' : 'never'}
        camera={{ position: [0, 120, 150], fov: 38, near: 1, far: 2000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#080B10']} />
        <fog attach="fog" args={['#080B10', 260, 520]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[60, 120, 40]} intensity={1.6} />
        <hemisphereLight args={['#bfd8ff', '#080B10', 0.35]} />
        <gridHelper args={[320, 32, '#232A36', '#141a24']} position={[0, -0.62, 0]} />
        {circuit && <Track key={circuit.slug} circuit={circuit} />}
        <CameraFit />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={50}
          maxDistance={520}
          maxPolarAngle={Math.PI * 0.47}
          autoRotate
          autoRotateSpeed={0.45}
        />
      </Canvas>
    </div>
  );
}
