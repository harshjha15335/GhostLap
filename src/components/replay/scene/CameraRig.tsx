import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { CircuitCurve } from '@/engine/circuitCurve';
import { useRaceLab } from '@/store/raceLabStore';
import { frame } from '../lib/frame';
import { circuitBounds } from './Track';

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Camera director. Every mode is expressed as anchor + offset:
 *  - anchor: a live point (focus car, ghost/real midpoint, or circuit centre)
 *  - offset/look: damped vectors relative to that anchor
 * Damping the *offsets* (not the absolute position) keeps follow cams locked
 * on even at 40× playback while mode changes glide.
 */
export function CameraRig({ curve }: { curve: CircuitCurve }) {
  const { camera, gl, scene, size } = useThree();
  const zoom = useRef(1);

  const rt = useMemo(() => {
    const box = circuitBounds(curve);
    const center = box.getCenter(new THREE.Vector3());
    const dims = box.getSize(new THREE.Vector3());
    return {
      center,
      dims,
      offset: new THREE.Vector3(0, 220, 40),
      look: new THREE.Vector3(),
      desiredOff: new THREE.Vector3(),
      desiredLook: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      carAnchor: new THREE.Vector3(),
      prevAnchor: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      tan: new THREE.Vector3(0, 0, 1),
      tanTarget: new THREE.Vector3(),
      topW: 1,
      focus: null as number | null,
      switchT: 1,
      orbit: 0,
      pairW: 0,
      pairDist: 0,
      init: false,
    };
  }, [curve]);

  // wheel / pinch zoom
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current = THREE.MathUtils.clamp(zoom.current * Math.exp(e.deltaY * 0.0012), 0.35, 2.6);
    };
    let pinch = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = dist(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch > 0) {
        const d = dist(e.touches);
        zoom.current = THREE.MathUtils.clamp(zoom.current * (pinch / d), 0.35, 2.6);
        pinch = d;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [gl]);

  const reset = useRaceLab((s) => s.camera);
  useEffect(() => {
    zoom.current = 1;
  }, [reset]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { camera: mode, focusDriver, ghost } = useRaceLab.getState();
    const cam = camera as THREE.PerspectiveCamera;

    // --- focus car anchor, with a 1 s blend when the focus changes
    const car = focusDriver != null ? frame.carGroups.get(focusDriver) : undefined;
    if (focusDriver !== rt.focus) {
      rt.prevAnchor.copy(rt.carAnchor);
      rt.focus = focusDriver;
      rt.switchT = rt.init ? 0 : 1;
    }
    rt.switchT = Math.min(1, rt.switchT + dt / 1.1);
    if (car && car.visible) {
      rt.tmp.copy(car.position);
      car.getWorldDirection(rt.tanTarget);
    } else {
      rt.tmp.copy(rt.carAnchor.lengthSq() ? rt.carAnchor : rt.center);
      rt.tanTarget.copy(rt.tan);
    }
    // ghost/real pair framing in broadcast + chase when the ghost is the focus driver's
    const g = frame.ghostGroup;
    const pair = !!ghost && ghost.scenario.driverNumber === focusDriver && !!g && !!car?.visible;
    const d = pair ? g!.position.distanceTo(rt.tmp) : 0;
    rt.pairW = THREE.MathUtils.damp(rt.pairW, pair && d < 70 ? 1 : 0, 2.5, dt);
    rt.pairDist = THREE.MathUtils.damp(rt.pairDist, pair ? Math.min(d, 70) : 0, 3, dt);
    if (rt.pairW > 0.001 && g) {
      rt.mid.copy(rt.tmp).lerp(g.position, 0.5);
      rt.tmp.lerp(rt.mid, rt.pairW);
    }

    if (rt.switchT < 1) rt.carAnchor.copy(rt.prevAnchor).lerp(rt.tmp, ease(rt.switchT));
    else rt.carAnchor.copy(rt.tmp);
    rt.tan.lerp(rt.tanTarget, 1 - Math.exp(-4 * dt)).normalize();

    // --- top-down weight
    rt.topW = THREE.MathUtils.damp(rt.topW, mode === 'topdown' ? 1 : 0, 2.6, dt);
    rt.anchor.copy(rt.carAnchor).lerp(rt.center, ease(THREE.MathUtils.clamp(rt.topW, 0, 1)));
    frame.topW = rt.topW;
    frame.chase = mode === 'chase';

    // --- desired offsets per mode
    const z = zoom.current;
    const spread = 1 + rt.pairDist / 26;
    if (mode === 'topdown') {
      const vfov = THREE.MathUtils.degToRad(cam.fov) / 2;
      const aspect = size.width / Math.max(1, size.height);
      // usable viewport is roughly the band between the top bar and the scrubber
      const h = Math.max((rt.dims.z / 2) / Math.tan(vfov), (rt.dims.x / 2) / (Math.tan(vfov) * aspect)) * 1.5;
      rt.desiredOff.set(0, h * z, h * 0.22 * z);
      rt.desiredLook.set(0, 0, h * 0.07 * z);
    } else if (mode === 'chase') {
      const back = 10.5 * z * (1 + rt.pairDist / 40);
      rt.desiredOff.copy(rt.tan).multiplyScalar(-back);
      rt.desiredOff.y += 4.4 * z * (1 + rt.pairDist / 60);
      rt.desiredLook.copy(rt.tan).multiplyScalar(3.5).setY(0.4);
    } else {
      rt.orbit += dt * 0.09;
      const R = 17 * z * spread;
      rt.desiredOff.set(Math.sin(rt.orbit) * R, 10.5 * z * spread, Math.cos(rt.orbit) * R);
      rt.desiredLook.set(0, 0.4, 0);
    }

    if (!rt.init) {
      rt.offset.set(0, 260, 60);
      rt.look.copy(rt.desiredLook);
      rt.init = true;
    }
    const k = 1 - Math.exp(-(mode === 'chase' ? 3.2 : 2.2) * dt);
    rt.offset.lerp(rt.desiredOff, k);
    rt.look.lerp(rt.desiredLook, k);

    cam.position.copy(rt.anchor).add(rt.offset);
    rt.tmp.copy(rt.anchor).add(rt.look);
    cam.lookAt(rt.tmp);

    // scale fog with viewing distance so the overview isn't swallowed
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      const dist = rt.offset.length();
      fog.near = dist * 0.9 + 20;
      fog.far = dist * 2.6 + 160;
    }
    const far = rt.offset.length() * 4 + 600;
    if (Math.abs(cam.far - far) > 50) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  });

  return null;
}
