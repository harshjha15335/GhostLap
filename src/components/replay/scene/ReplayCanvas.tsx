import { memo, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RaceBundle } from '@/types';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import { createCircuitCurve } from '@/engine/circuitCurve';
import { useRaceLab } from '@/store/raceLabStore';
import { frame } from '../lib/frame';
import { Track } from './Track';
import { Cars } from './Cars';
import { GhostCar } from './GhostCar';
import { CameraRig } from './CameraRig';

/** Advances the race clock and samples car states once per frame (runs before everything else). */
function RaceClock() {
  const last = useMemo(() => ({ time: NaN, ghost: null as unknown, timeline: null as unknown }), []);
  useFrame((_, rawDt) => {
    const s = useRaceLab.getState();
    const tl = s.timeline;
    if (!tl) return;
    if (s.playing) s.setTime(s.time + Math.min(rawDt, 0.1) * s.speed);
    const { time, ghost } = useRaceLab.getState();
    if (time === last.time && ghost === last.ghost && tl === last.timeline) return;
    last.time = time;
    last.ghost = ghost;
    last.timeline = tl;
    const states = tl.statesAt(time);
    frame.time = time;
    frame.states = states;
    frame.byDriver.clear();
    frame.gapBehind.clear();
    for (let i = 0; i < states.length; i++) {
      frame.byDriver.set(states[i].driverNumber, states[i]);
      const next = states[i + 1];
      if (next && !next.retired) frame.gapBehind.set(states[i].driverNumber, next.gapAhead);
    }
    frame.ghost = ghost ? tl.ghostProgressAt(ghost, time) : null;
  }, -3);
  return null;
}

const Scene = memo(function Scene({ bundle, timeline }: { bundle: RaceBundle; timeline: RaceTimeline }) {
  const curve = useMemo(() => createCircuitCurve(bundle.circuit), [bundle]);
  return (
    <>
      <color attach="background" args={['#080B10']} />
      <fog attach="fog" args={['#080B10', 120, 520]} />
      <hemisphereLight args={['#b8c6ff', '#0a0c10', 0.55]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[80, 140, 60]} intensity={1.6} />
      <directionalLight position={[-90, 60, -80]} intensity={0.45} color="#7fb0ff" />
      <RaceClock />
      <Track circuit={bundle.circuit} curve={curve} />
      <Cars bundle={bundle} timeline={timeline} curve={curve} />
      <GhostCar bundle={bundle} curve={curve} />
      <CameraRig curve={curve} />
    </>
  );
});

export default function ReplayCanvas({ bundle, timeline }: { bundle: RaceBundle; timeline: RaceTimeline }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
      camera={{ fov: 45, near: 0.3, far: 2000, position: [0, 260, 60] }}
      onPointerMissed={() => undefined}
      style={{ touchAction: 'none' }}
    >
      <Scene bundle={bundle} timeline={timeline} />
    </Canvas>
  );
}
