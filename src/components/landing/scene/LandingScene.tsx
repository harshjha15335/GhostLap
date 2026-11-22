import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import type { HotspotId, LandingBus } from '../bus';
import { FOV, type LandingLayout } from '../layout';
import type { FlowCar } from '../stats';
import CameraRig from './CameraRig';
import DriveTrack from './DriveTrack';
import type { DrivePath } from './drivePath';
import HeroCar from './HeroCar';
import SCurveFlow from './SCurveFlow';
import World from './World';

/**
 * The single WebGL context for the whole landing page. Fixed behind the DOM;
 * every chapter is a camera move through this one persistent world (a dark studio
 * set for hero / specimen / S-curve and the real Silverstone circuit for the drive).
 */
export default function LandingScene({
  bus,
  layout,
  hover,
  grid,
  path,
  live = true,
}: {
  bus: LandingBus;
  layout: LandingLayout;
  hover: HotspotId | null;
  grid: FlowCar[];
  path: DrivePath | null;
  /** false while DOM-only chapters cover the canvas: stop rendering entirely */
  live?: boolean;
}) {
  const q = bus.quality;
  return (
    <Canvas
      frameloop={live ? 'always' : 'never'}
      dpr={q.dpr}
      shadows={false}
      gl={{ antialias: !q.mobile, powerPreference: 'high-performance', alpha: false }}
      camera={{ fov: FOV, near: 0.3, far: 4000, position: [-6, 1.6, 8] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* rig first so its useFrame runs before anything that projects anchors */}
      <CameraRig bus={bus} layout={layout} />
      <Suspense fallback={null}>
        <World bus={bus} />
        <HeroCar bus={bus} hover={hover} />
        <SCurveFlow bus={bus} grid={grid} />
      </Suspense>
      {path && (
        <Suspense fallback={null}>
          <DriveTrack bus={bus} path={path} />
        </Suspense>
      )}
    </Canvas>
  );
}
