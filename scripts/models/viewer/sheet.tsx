// Dev-only: renders the real <F1Car> for all 11 teams (contact sheet for the livery work).
// Query: ?detail=high|mid|low&yaw=0.6
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useEffect } from 'react';
import { F1Car } from '@/components/three/F1Car';

const TEAMS = ['mercedes', 'ferrari', 'mclaren', 'red-bull-racing', 'aston-martin', 'alpine', 'williams', 'racing-bulls', 'haas-f1-team', 'audi', 'cadillac'];
const q = new URLSearchParams(location.search);
const detail = (q.get('detail') ?? 'high') as 'high' | 'mid' | 'low';
const yaw = Number(q.get('yaw') ?? 0.75);
const COLS = 4;
const only = q.get('team');
const shown = only ? [only] : TEAMS;

function Ready() {
  useEffect(() => {
    const t = setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), 9000);
    return () => clearTimeout(t);
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ position: only ? [4.2, 2.6, 4.6] : [0, 27, 15], fov: only ? 40 : 32 }} onCreated={({ camera }) => camera.lookAt(0, only ? 0.4 : 0, only ? 0 : 0.6)}>
    <color attach="background" args={['#fff7ee']} />
    <ambientLight intensity={0.7} />
    <hemisphereLight args={['#ffffff', '#3A2BD0', 0.8]} />
    <directionalLight position={[-6, 10, 8]} intensity={1.8} />
    <directionalLight position={[8, 4, -6]} intensity={0.6} />
    {shown.map((t, i) => {
      const x = only ? 0 : ((i % COLS) - (COLS - 1) / 2) * 6.4;
      const z = only ? 0 : (Math.floor(i / COLS) - 1) * 6.2;
      return (
        <group key={t} position={[x, 0, z]}>
          <F1Car teamId={t} detail={detail} number={only ? 7 : i + 1} rotation={[0, yaw, 0]} tyreColor="#FFD23F" tyreGlow={0.6} />
          <Html position={[0, 0, 2.8]} center>
            <div style={{ background: '#170F33', color: '#fff', padding: '1px 6px', whiteSpace: 'nowrap' }}>{t}</div>
          </Html>
        </group>
      );
    })}
    <Ready />
  </Canvas>,
);
