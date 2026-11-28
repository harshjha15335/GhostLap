import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CircuitGeometry } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';
import { CircuitEnvironment } from '@/components/track/CircuitEnvironment';
import { REPLAY_TRACK_OPTS } from '../lib/dims';

/**
 * Replay circuit: the shared environment at "low" quality, built with exactly the
 * track-model options the lane maths uses (lib/dims.ts REPLAY_TRACK_OPTS), so racing
 * line, passing lanes and track limits match the asphalt that is drawn. The pit lane
 * sits at PIT_LANE_OFFSET where the field puts pitting cars.
 */
export function Track({
  circuit,
  curve,
  rich = true,
  shadows = false,
}: {
  circuit: CircuitGeometry;
  curve: CircuitCurve;
  /** false (Low quality): trackside scatter (trees, buildings, props: the instanced meshes) hidden */
  rich?: boolean;
  shadows?: boolean;
}) {
  const o = REPLAY_TRACK_OPTS;
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    group.current?.traverse((obj) => {
      if ((obj as THREE.InstancedMesh).isInstancedMesh) obj.visible = rich;
    });
  });
  return (
    <group ref={group}>
    <CircuitEnvironment
      circuit={circuit}
      curve={curve}
      quality={o.quality}
      trackWidth={o.trackWidth}
      minHalfWidth={o.minHalfWidth}
      pitLane={o.pitLane}
      pitSpan={o.pitSpan}
      showSectors
      shadows={shadows}
    />
    </group>
  );
}

/** Bounds helper for cameras. */
export function circuitBounds(curve: CircuitCurve) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < 200; i++) box.expandByPoint(curve.pointAt(i / 200, v));
  return box;
}
