import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Bright daytime sky shared by the circuit inspector and the Race Lab: one inverted
 * sphere (1 draw call) with a vertical gradient from a saturated zenith blue to a warm,
 * pale horizon. It follows the camera, ignores fog/depth, and sets the scene background
 * + fog to the horizon colour so the diorama's far edges melt into the haze.
 */
export const SKY = {
  zenith: '#3E8EF0',
  mid: '#8FD0FF',
  horizon: '#E4F3FF',
  ground: '#7FC2F2',
} as const;

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;

const frag = /* glsl */ `
uniform vec3 zenith;
uniform vec3 mid;
uniform vec3 horizon;
uniform vec3 ground;
varying vec3 vDir;
void main() {
  float y = vDir.y;
  vec3 c = y > 0.0
    ? mix(mix(horizon, mid, smoothstep(0.0, 0.22, y)), zenith, smoothstep(0.22, 0.85, y))
    : mix(horizon, ground, smoothstep(0.0, 0.35, -y));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function SkyDome({ fogNear, fogFar, radius = 900 }: { fogNear?: number; fogFar?: number; radius?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          zenith: { value: new THREE.Color(SKY.zenith) },
          mid: { value: new THREE.Color(SKY.mid) },
          horizon: { value: new THREE.Color(SKY.horizon) },
          ground: { value: new THREE.Color(SKY.ground) },
        },
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);

  // background + fog in the horizon colour (restored on unmount)
  useEffect(() => {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color(SKY.horizon);
    if (fogNear != null && fogFar != null) scene.fog = new THREE.Fog(SKY.horizon, fogNear, fogFar);
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  }, [scene, fogNear, fogFar]);

  useFrame(() => {
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <mesh ref={ref} material={mat} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  );
}

export default SkyDome;
