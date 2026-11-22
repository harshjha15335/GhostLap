import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { CircuitGeometry } from '@/types';
import { createCircuitCurve, type CircuitCurve } from '@/engine/circuitCurve';
import { useCanvasDpr, useInView, useIsMobile } from '@/components/ui/hooks';
import { CircuitEnvironment } from '@/components/track/CircuitEnvironment';
import { SkyDome } from '@/components/track/SkyDome';
import { SECTOR_COLORS } from './TrackOutline';

/** Thin sector-coloured line hovering over the racing line (the legend's S1/S2/S3). */
function SectorLine({ circuit, curve }: { circuit: CircuitGeometry; curve: CircuitCurve }) {
  const line = useMemo(() => {
    const N = 1200;
    const HW = 0.16;
    const [s1, s2] = circuit.sectorSplits;
    const cols = SECTOR_COLORS.map((c) => new THREE.Color(c));
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const f = (i % N) / N;
      curve.pointAt(f, p);
      curve.tangentAt(f, t);
      const L = Math.hypot(t.x, t.z) || 1;
      const rx = -t.z / L, rz = t.x / L;
      pos.push(p.x - rx * HW, p.y + 0.12, p.z - rz * HW, p.x + rx * HW, p.y + 0.12, p.z + rz * HW);
      const c = cols[f < s1 ? 0 : f < s2 ? 1 : 2];
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    return new THREE.Mesh(g, m);
  }, [circuit, curve]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

function GhostRunner({ curve }: { curve: CircuitCurve }) {
  const ref = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    curve.pointAt((clock.elapsedTime * 0.035) % 1, tmp);
    ref.current.position.set(tmp.x, tmp.y + 0.9, tmp.z);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.75, 16, 12]} />
      <meshBasicMaterial color="#00F5D4" toneMapped={false} />
    </mesh>
  );
}

/** Bright midday sun with a shadow frustum sized to the circuit block. */
function Sun({ curve, shadows }: { curve: CircuitCurve; shadows: boolean }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const span = useMemo(() => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < 200; i++) box.expandByPoint(curve.pointAt(i / 200, v));
    const s = box.getSize(v);
    return Math.max(s.x, s.z) * 0.7 + 20;
  }, [curve]);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = cam.bottom = -span;
    cam.right = cam.top = span;
    cam.near = 1;
    cam.far = 700;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [span]);
  return (
    <directionalLight
      ref={ref}
      position={[140, 170, 90]}
      intensity={2.6}
      color="#fff1d6"
      castShadow={shadows}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.04}
    />
  );
}

function Scene({ circuit, shadows, mobile }: { circuit: CircuitGeometry; shadows: boolean; mobile: boolean }) {
  const curve = useMemo(() => createCircuitCurve(circuit), [circuit]);
  return (
    <>
      <Sun curve={curve} shadows={shadows} />
      <CircuitEnvironment circuit={circuit} curve={curve} quality={mobile ? 'low' : 'high'} trackWidth={3.0} minHalfWidth={1.0} shadows={shadows} />
      <SectorLine circuit={circuit} curve={curve} />
      <GhostRunner curve={curve} />
    </>
  );
}

/** Frames the circuit block for the current aspect ratio (portrait phones need a longer lens). */
function CameraFit() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(330 / (2 * half * aspect), 270 / (2 * half)) * 0.95;
    camera.position.set(0, dist * 0.6, dist * 0.8);
    camera.lookAt(0, 0, 0);
  }, [camera, aspect]);
  return null;
}

export default function CircuitInspector({ circuit }: { circuit: CircuitGeometry | null }) {
  const dpr = useCanvasDpr();
  const mobile = useIsMobile();
  const [wrapRef, inView] = useInView<HTMLDivElement>();
  const shadows = !mobile;
  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Canvas
        dpr={dpr}
        shadows={shadows}
        frameloop={inView ? 'always' : 'never'}
        camera={{ position: [0, 120, 150], fov: 38, near: 1, far: 2000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        {/* bright daytime sky (background + horizon fog come from the dome) */}
        <SkyDome fogNear={380} fogFar={900} />
        <hemisphereLight args={['#dcefff', '#5d7a3e', 1.05]} />
        <ambientLight intensity={0.28} />
        <directionalLight position={[-120, 60, -100]} intensity={0.45} color="#bcd8ff" />
        {circuit && <Scene key={circuit.slug} circuit={circuit} shadows={shadows} mobile={mobile} />}
        <CameraFit />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={25}
          maxDistance={520}
          maxPolarAngle={Math.PI * 0.47}
          autoRotate
          autoRotateSpeed={0.45}
        />
      </Canvas>
    </div>
  );
}
