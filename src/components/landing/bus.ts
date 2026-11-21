import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ChoreoState } from '@/hooks/useScrollChoreography';
import type { Quality } from './quality';

export type HotspotId = 'aero' | 'halo' | 'wake' | 'tyres';

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
