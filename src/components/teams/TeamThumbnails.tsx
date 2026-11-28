import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { F1Car } from '@/components/three/F1Car';
import { requestTeamAtlas } from '@/components/three/liveries';
import { loadW17 } from '@/components/three/w17';

/**
 * Team-card car renders without 11 live WebGL contexts: ONE hidden <Canvas> paints each
 * team's W17 in turn, snapshots it to an image (object URL) and, when every team is done,
 * unmounts — so the /teams grid ends up with zero live GPU contexts. Snapshots are kept
 * for the session (module cache), so coming back to /teams costs nothing.
 */

export interface ThumbJob {
  teamId: string;
  number?: number;
  color: string;
}

const VIEW_DIR = new THREE.Vector3(5.6, 3.2, 6.4).normalize();
const W = 600;
const H = 320;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** The team's snapshot URL once rendered (undefined until then). */
export function useTeamThumbnail(teamId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => cache.get(teamId));
}

function atlasReady(teamId: string): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, 5000); // failed / unknown atlas → render with the painted fallback
    const done = () => {
      window.clearTimeout(t);
      resolve();
    };
    if (requestTeamAtlas(teamId, 'md', done)) done();
  });
}

/** Copy of the snapshot trimmed to its non-transparent pixels (+ a little air), so cards can fill with the car. */
function cropToContent(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return src;
  g.drawImage(src, 0, 0);
  const a = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return src;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function Shot({ job, onDone }: { job: ThumbJob; onDone: (url: string | null) => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const sent = useRef(false);
  const car = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame(() => {
    frames.current++;
    if (frames.current === 1 && car.current) {
      // frame the car: fit its bounding sphere along a fixed 3/4-front direction
      const sphere = new THREE.Box3().setFromObject(car.current).getBoundingSphere(new THREE.Sphere());
      const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.72;
      camera.position.copy(VIEW_DIR).multiplyScalar(dist).add(sphere.center);
      camera.lookAt(sphere.center);
      camera.updateProjectionMatrix();
    }
    // a few frames for shader compile + contact shadow, then snapshot the drawing buffer
    if (frames.current < 5 || sent.current) return;
    sent.current = true;
    cropToContent(gl.domElement).toBlob((b) => onDone(b ? URL.createObjectURL(b) : null), 'image/webp', 0.9);
  });
  return (
    <group>
      <group ref={car} rotation={[0, -0.22, 0]}>
        <F1Car detail="mid" teamId={job.teamId} color={job.color} accent={job.color} number={job.number} tyreGlow={0.35} tyreColor="#FFD23F" />
      </group>
      <ContactShadows position={[0, 0.005, 0]} opacity={0.5} scale={9} blur={2.2} far={2} resolution={256} frames={1} color="#170F33" />
    </group>
  );
}

function Queue({ jobs, onFinished }: { jobs: ThumbJob[]; onFinished: () => void }) {
  const [i, setI] = useState(0);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const job = jobs[i];
  useEffect(() => {
    if (!job) {
      onFinished();
      return;
    }
    let alive = true;
    Promise.all([loadW17('mid').catch(() => undefined), atlasReady(job.teamId)]).then(() => alive && setReadyFor(job.teamId));
    return () => {
      alive = false;
    };
  }, [job, onFinished]);
  if (!job || readyFor !== job.teamId) return null;
  return (
    <Shot
      key={job.teamId}
      job={job}
      onDone={(url) => {
        if (url) {
          cache.set(job.teamId, url);
          emit();
        }
        setI((k) => k + 1);
      }}
    />
  );
}

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Renders the missing team snapshots, then removes its own canvas. */
export function TeamThumbnailRenderer({ jobs }: { jobs: ThumbJob[] }) {
  const [todo] = useState(() => jobs.filter((j) => !cache.has(j.teamId)));
  const [finished, setFinished] = useState(todo.length === 0);
  const finish = useRef(() => setFinished(true)).current;
  if (finished) return null;
  return (
    <Quiet>
      <div aria-hidden className="pointer-events-none fixed left-0 top-0 -z-10 opacity-0" style={{ width: W, height: H }}>
        <Canvas
          dpr={1.5}
          camera={{ position: [5.6, 2.1, 6.4], fov: 27, near: 0.1, far: 60 }}
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        >
          <ambientLight intensity={0.85} />
          <hemisphereLight args={['#ffffff', '#5a4a9a', 0.9]} />
          <directionalLight position={[-5, 8, 8]} intensity={1.8} color="#fffaf0" />
          <directionalLight position={[6, 3, -6]} intensity={0.9} color="#ffe9c7" />
          <Queue jobs={todo} onFinished={finish} />
        </Canvas>
      </div>
    </Quiet>
  );
}
