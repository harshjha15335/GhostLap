import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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

function Shot({ job, onDone }: { job: ThumbJob; onDone: (url: string | null) => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const sent = useRef(false);
  useFrame(() => {
    frames.current++;
    // a few frames for shader compile + contact shadow, then snapshot the drawing buffer
    if (frames.current < 4 || sent.current) return;
    sent.current = true;
    gl.domElement.toBlob((b) => onDone(b ? URL.createObjectURL(b) : null), 'image/webp', 0.9);
  });
  return (
    <group>
      <group rotation={[0, 0.62, 0]}>
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
          onCreated={({ camera }) => camera.lookAt(0, 0.45, 0)}
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
