import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ChoreoState } from '@/hooks/useScrollChoreography';
import type { Quality } from './quality';
import type { DrivePath } from './scene/drivePath';

export type HotspotId = 'aero' | 'halo' | 'wake' | 'tyres';

/** Which 3D "set" is on stage: the paper studio (hero, specimen, S-curve) or the winding drive road. */
export type SceneSet = 'studio' | 'circuit';

/**
 * Mutable, render-free channel between the DOM chapters and the 3D scene.
 * Created once per Landing mount; nothing here is global, so the WebGL scene
 * and every listener are released when the route unmounts.
 */
export interface LandingBus {
  choreo: MutableRefObject<ChoreoState>;
  quality: Quality;
  /** normalised pointer, -1..1, y up */
  pointer: { x: number; y: number; active: boolean };
  /** DOM elements positioned every frame from projected 3D anchors */
  anchors: Record<string, HTMLElement | null>;
  /** camera focus point (lights + particles follow it) */
  focus: THREE.Vector3;
  /** set by the camera rig every frame */
  set: SceneSet;
  /** hide the hero car (S-curve chapter) */
  showCar: boolean;
  /** damped lap fraction of the drive (0..1), written by the camera rig */
  lapT: number;
  /** the drive chapter's procedural road */
  path: DrivePath | null;
  /** hero framing: document px of the headline bottom (the car sits just below it) */
  heroFrame: { top: number; bottom: number };
  /** hero horizon written by the camera rig: document y (px) of its lowest point and its edge rise (px) */
  horizon: { y: number; sag: number };
  /** full-viewport coloured paper wipe used to hide set changes */
  veil: HTMLElement | null;
}

const v = new THREE.Vector3();

/** Position a DOM overlay element at a projected world point. */
export function placeAnchor(
  el: HTMLElement | null | undefined,
  world: THREE.Vector3,
  camera: THREE.Camera,
  w: number,
  h: number,
  opacity: number,
) {
  if (!el) return;
  if (opacity > 0.01) {
    v.copy(world).project(camera);
    if (v.z > 1 || v.z < -1) opacity = 0;
  }
  if (opacity <= 0.01) {
    if (el.dataset.vis !== '0') {
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      el.dataset.vis = '0';
    }
    return;
  }
  const x = (v.x * 0.5 + 0.5) * w;
  const y = (-v.y * 0.5 + 0.5) * h;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  el.style.opacity = opacity.toFixed(3);
  if (el.dataset.vis !== '1') {
    el.style.visibility = 'visible';
    el.dataset.vis = '1';
  }
}
