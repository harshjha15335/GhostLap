import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** Small helper hook: smoothly animate a numeric value toward a target each frame. */
export function useDamped(target: number, lambda = 6) {
  const v = useRef(target);
  useFrame((_, dt) => {
    v.current = THREE.MathUtils.damp(v.current, target, lambda, dt);
  });
  return v;
}
