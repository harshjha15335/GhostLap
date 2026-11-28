import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import type { RaceBundle } from '@/types';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import { useRaceLab } from '@/store/raceLabStore';
import { frame } from '../lib/frame';
import { ghostProgress } from '../lib/raceMath';
import { Track } from './Track';
import { Cars } from './Cars';
import { GhostCar } from './GhostCar';
import { CameraRig } from './CameraRig';
import { Airflow } from './Airflow';
import { Incidents } from './Incidents';
import { TrackSignals } from './TrackSignals';
import { SafetyCar } from './SafetyCar';
import { RacingLine } from './RacingLine';
import { buildRaceScene } from '../lib/raceScene';
import { SkyDome } from '@/components/track/SkyDome';
import { CarShadows } from './CarShadows';
import { useReplayPrefs } from '../lib/prefs';
import { qualityLevel, qualitySettings, useReplayQuality, type QualitySettings } from '../lib/quality';

/** Low quality: a flat sky (background + fog in the horizon colour) instead of the dome. */
function FlatSky() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color('#cfe6f7');
    scene.fog = new THREE.Fog('#cfe6f7', 170, 720);
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  }, [scene]);
  return null;
}

/** sun light; shadow-mapped only at the top of the quality ladder */
function Sun({ shadows }: { shadows: boolean }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.castShadow = shadows;
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = c.bottom = -130;
    c.right = c.top = 130;
    c.near = 10;
    c.far = 420;
    c.updateProjectionMatrix();
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.bias = -0.0008;
  }, [shadows]);
  return <directionalLight ref={ref} position={[80, 140, 60]} intensity={2.1} color="#fff3dc" />;
}

/** Advances the race clock and samples car states once per frame (runs before everything else). */
function RaceClock() {
  const last = useMemo(() => ({ time: NaN, ghost: null as unknown, timeline: null as unknown }), []);
  useFrame(({ gl }, rawDt) => {
    // dev only: last frame's renderer stats for the QA scripts (draw-call budget)
    if (import.meta.env.DEV) frame.glStats = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    const s = useRaceLab.getState();
    const tl = s.timeline;
    if (!tl) return;
    if (s.playing) s.setTime(s.time + Math.min(rawDt, 0.1) * s.speed);
    const { time, ghost } = useRaceLab.getState();
    if (time === last.time && ghost === last.ghost && tl === last.timeline) return;
    last.time = time;
    last.ghost = ghost;
    last.timeline = tl;
    const states = tl.statesAt(time, frame.states);
    frame.time = time;
    frame.status = tl.trackStatusAt(time);
    frame.states = states;
    frame.byDriver.clear();
    frame.gapBehind.clear();
    for (let i = 0; i < states.length; i++) {
      frame.byDriver.set(states[i].driverNumber, states[i]);
      const next = states[i + 1];
      if (next && !next.retired) frame.gapBehind.set(states[i].driverNumber, next.gapAhead);
    }
    frame.ghost = ghost ? ghostProgress(tl, ghost, time) : null;
  }, -3);
  return null;
}

const Scene = memo(function Scene({ bundle, timeline, quality }: { bundle: RaceBundle; timeline: RaceTimeline; quality: QualitySettings }) {
  // circuit clean-up, track model, racing line and incident plans: once per race
  const scene = useMemo(() => buildRaceScene(bundle, timeline), [bundle, timeline]);
  const { curve } = scene;
  frame.scene = scene;
  return (
    <>
      {/* bright daytime sky; background + horizon-haze fog come from the dome */}
      {quality.richEnvironment ? <SkyDome fogNear={170} fogFar={720} /> : <FlatSky />}
      <hemisphereLight args={['#dcefff', '#5d7a3e', 1.0]} />
      <ambientLight intensity={0.3} />
      <Sun shadows={quality.envShadows} />
      <directionalLight position={[-90, 60, -80]} intensity={0.5} color="#bcd8ff" />
      <RaceClock />
      <Track circuit={scene.circuit} curve={curve} rich={quality.richEnvironment} shadows={quality.envShadows} />
      {quality.carShadows && <CarShadows />}
      <RacingLine scene={scene} />
      <Cars scene={scene} />
      <Airflow scene={scene} density={quality.airflowDensity} />
      <Incidents scene={scene} />
      <TrackSignals scene={scene} />
      {scene.sc.length > 0 && (
        <Suspense fallback={null}>
          <SafetyCar scene={scene} />
        </Suspense>
      )}
      <GhostCar bundle={bundle} curve={curve} />
      <CameraRig curve={curve} />
    </>
  );
});

export default function ReplayCanvas({ bundle, timeline }: { bundle: RaceBundle; timeline: RaceTimeline }) {
  const mode = useReplayPrefs((s) => s.quality);
  const factor = useReplayQuality((s) => s.factor);
  const setFactor = useReplayQuality((s) => s.setFactor);
  const quality = useMemo(() => qualitySettings(qualityLevel(mode, factor)), [mode, factor]);
  return (
    <Canvas
      dpr={Math.min(quality.dpr, typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1)}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
      camera={{ fov: 45, near: 0.3, far: 2000, position: [0, 260, 60] }}
      onPointerMissed={() => undefined}
      style={{ touchAction: 'none' }}
    >
      {/* Auto: step quality down when the frame rate drops, back up with headroom */}
      {mode === 'auto' && (
        <PerformanceMonitor
          factor={0.7}
          step={0.1}
          flipflops={6}
          onChange={({ factor: f, fps }) => setFactor(f, fps)}
          onFallback={({ fps }) => setFactor(0, fps)}
        />
      )}
      <Scene bundle={bundle} timeline={timeline} quality={quality} />
    </Canvas>
  );
}
