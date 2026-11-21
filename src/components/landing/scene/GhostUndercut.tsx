import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { F1Car } from '@/components/three/F1Car';
import { range01, smooth01 } from '@/hooks/useScrollChoreography';
import { placeAnchor, type LandingBus } from '../bus';
import { U_CENTER_Z } from '../layout';
import { ribbonGeometry, samplePoints } from './geometry';
import { radialTexture } from './textures';

const Z = U_CENTER_Z;
const PIT_Z = Z + 13;
const RIVAL_LANE = Z - 1.6;

const trailFrag = /* glsl */ `
uniform float uHead; varying vec2 vUv;
void main(){
  float behind = uHead - vUv.x;
  if (behind < 0.0) discard;
  float across = abs(vUv.y - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, across) * exp(-behind / 38.0) * 0.85;
  gl_FragColor = vec4(vec3(0.0, 0.96, 0.83) * a, a);
}`;
const trailVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export default function GhostUndercut({ bus }: { bus: LandingBus }) {
  const root = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Group>(null);
  const real = useRef<THREE.Group>(null);
  const rival = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  const ghostPath = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [
          [-64, Z],
          [-54, Z],
          [-46, Z + 1.5],
          [-38, Z + 9],
          [-29, PIT_Z],
          [0, PIT_Z],
          [29, PIT_Z],
          [38, Z + 9],
          [46, Z + 1.5],
          [54, Z],
          [70, Z],
        ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
        false,
        'centripetal',
      ),
    [],
  );
  const pathLen = useMemo(() => ghostPath.getLength(), [ghostPath]);

  const geo = useMemo(() => {
    const main = [new THREE.Vector3(-120, 0, Z), new THREE.Vector3(120, 0, Z)];
    const pitPts = samplePoints(ghostPath, 160, 0.12, 0.88);
    return {
      track: ribbonGeometry(main, 15, 0, 0.03),
      lineA: ribbonGeometry(main, 0.35, -7.6, 0.045),
      lineB: ribbonGeometry(main, 0.35, 7.6, 0.045),
      pit: ribbonGeometry(pitPts, 6.5, 0, 0.025),
      pitLine: ribbonGeometry(pitPts, 0.2, 3.3, 0.04),
      trail: ribbonGeometry(samplePoints(ghostPath, 260), 1.6, 0, 0.06),
    };
  }, [ghostPath]);

  const mats = useMemo(() => {
    const glow = radialTexture('rgba(0,245,212,0.9)', 'rgba(0,245,212,0)');
    return {
      track: new THREE.MeshStandardMaterial({ color: '#141820', roughness: 0.42, metalness: 0.25 }),
      pit: new THREE.MeshStandardMaterial({ color: '#10151F', roughness: 0.5, metalness: 0.2 }),
      line: new THREE.MeshBasicMaterial({ color: '#f1f3f6', toneMapped: false }),
      pitLine: new THREE.MeshBasicMaterial({ color: '#D4FF00', toneMapped: false }),
      trail: new THREE.ShaderMaterial({
        vertexShader: trailVert,
        fragmentShader: trailFrag,
        uniforms: { uHead: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
      box: new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      glow,
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats],
  );

  const tmp = useMemo(() => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), a: new THREE.Vector3() }), []);

  useFrame((state) => {
    const s = bus.choreo.current;
    const ch = s.chapters;
    const near = s.scrollY > ch[4].top - s.vh * 1.6;
    if (root.current) root.current.visible = near;
    const W = state.size.width;
    const H = state.size.height;
    if (!near) {
      ['ug-box', 'ug-ghost', 'ug-rival', 'ug-real', 'ug-gain'].forEach((id) => placeAnchor(bus.anchors[id], tmp.a, camera, W, H, 0));
      return;
    }
    const reduced = s.reducedMotion;
    const k = reduced ? 1 : smooth01(range01(ch[4].progress, 0.06, 0.9));
    const { p, t, a } = tmp;

    // rival + real car stay on the racing line
    const rx = -50 + 102 * k;
    rival.current?.position.set(rx, 0, RIVAL_LANE);
    real.current?.position.set(-64 + 104 * k, 0, Z + 1.6);
    // ghost splits from the real car into the pit lane and rejoins ahead
    ghostPath.getPointAt(k, p);
    ghostPath.getTangentAt(k, t);
    const g = ghost.current;
    if (g) {
      g.position.set(p.x, 0.04, p.z);
      g.rotation.y = Math.atan2(t.x, t.z);
    }
    mats.trail.uniforms.uHead.value = k * pathLen;

    // labels
    const inCh = range01(s.scrollY, ch[4].top - s.vh * 0.2, ch[4].top + s.vh * 0.2) * (1 - range01(s.scrollY, ch[5].top - s.vh * 0.6, ch[5].top - s.vh * 0.1));
    a.set(0, 2.6, PIT_Z + 1);
    placeAnchor(bus.anchors['ug-box'], a, camera, W, H, inCh * (k > 0.25 && k < 0.75 ? 1 : 0.35));
    a.set(p.x, 3.2, p.z);
    placeAnchor(bus.anchors['ug-ghost'], a, camera, W, H, inCh);
    a.set(rx, 3.2, RIVAL_LANE);
    placeAnchor(bus.anchors['ug-rival'], a, camera, W, H, inCh);
    a.set(-64 + 104 * k, 3.2, Z + 1.6);
    placeAnchor(bus.anchors['ug-real'], a, camera, W, H, inCh * (1 - range01(k, 0.6, 0.8)) * range01(k, 0.12, 0.25));
    a.set(p.x + 4, 6, p.z);
    placeAnchor(bus.anchors['ug-gain'], a, camera, W, H, inCh * range01(k, 0.86, 0.95));
  });

  return (
    <group ref={root}>
      <mesh geometry={geo.track} material={mats.track} />
      <mesh geometry={geo.lineA} material={mats.line} />
      <mesh geometry={geo.lineB} material={mats.line} />
      <mesh geometry={geo.pit} material={mats.pit} />
      <mesh geometry={geo.pitLine} material={mats.pitLine} />
      <mesh geometry={geo.trail} material={mats.trail} renderOrder={3} />
      {/* pit wall with a neon cap */}
      <mesh position={[0, 0.5, Z + 9.2]}>
        <boxGeometry args={[52, 1, 0.5]} />
        <meshStandardMaterial color="#1a1f29" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.02, Z + 9.2]}>
        <boxGeometry args={[52, 0.06, 0.52]} />
        <meshBasicMaterial color="#D4FF00" toneMapped={false} />
      </mesh>
      {/* pit box */}
      <mesh position={[0, 0.05, PIT_Z]} rotation={[-Math.PI / 2, 0, 0]} material={mats.box}>
        <planeGeometry args={[10, 7]} />
      </mesh>
      <group ref={rival} rotation={[0, Math.PI / 2, 0]}>
        <F1Car color="#FF1E1E" accent="#F2F2F2" detail="low" tyreColor="#F2F2F2" tyreGlow={0.6} />
      </group>
      <group ref={real} rotation={[0, Math.PI / 2, 0]}>
        <F1Car color="#D4FF00" accent="#11151b" detail="low" tyreColor="#FFD400" tyreGlow={0.6} />
      </group>
      <group ref={ghost}>
        <F1Car ghost detail="high" tyreGlow={1} />
      </group>
    </group>
  );
}
