import * as THREE from 'three';
import type { CircuitGeometry } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';
import { CircuitEnvironment } from '@/components/track/CircuitEnvironment';
import { TRACK_WIDTH, PIT_LANE_OFFSET } from '../lib/frame';

/**
 * Replay circuit: the shared environment at "low" quality. Real track widths are
 * scaled so the mean equals TRACK_WIDTH; the half-width never drops below what the
 * side-by-side lanes in Cars.tsx need (±1.05 + half a car), and the pit lane sits
 * at PIT_LANE_OFFSET exactly where Cars.tsx parks pitting cars.
 */
export function Track({ circuit, curve }: { circuit: CircuitGeometry; curve: CircuitCurve }) {
  return (
    <CircuitEnvironment
      circuit={circuit}
      curve={curve}
      quality="low"
      trackWidth={TRACK_WIDTH}
      minHalfWidth={1.5}
      pitLane={{ offset: PIT_LANE_OFFSET, width: 1.3 }}
      pitSpan={0.075}
      showSectors
    />
  );
}

/** Bounds helper for cameras. */
export function circuitBounds(curve: CircuitCurve) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < 200; i++) box.expandByPoint(curve.pointAt(i / 200, v));
  return box;
}
