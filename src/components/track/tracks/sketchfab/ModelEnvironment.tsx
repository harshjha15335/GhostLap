import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader, MeshoptDecoder } from 'three-stdlib';
import type { CircuitEnvironmentProps } from '../../CircuitEnvironment';
import { buildTrackModel } from '../../trackModel';
import { asphaltTexture, buildAsphalt, buildKerbs, buildLayout, buildLines } from '../../geometry';

export function modelUrl(slug: string, quality: 'high' | 'low'): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}models/circuits/${slug}/${slug}-${quality}.glb`;
}

const withMeshopt = (loader: THREE.Loader) => {
  (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder());
};

/**
 * A real circuit's surroundings from a baked model (already fitted to the racing line),
 * with GhostLap's own asphalt, kerbs and lines drawn on top so the cars' lanes and the
 * track limits are exactly those of every other circuit. Suspends while the GLB loads.
 */
export default function ModelEnvironment({
  circuit,
  curve,
  quality = 'high',
  trackWidth = 3.2,
  minHalfWidth = 0.9,
  pitLane = null,
  pitSpan = 0.075,
  showSectors = false,
  shadows = false,
}: CircuitEnvironmentProps) {
  const lod = quality === 'low' ? 'low' : 'high';
  const gltf = useLoader(GLTFLoader, modelUrl(circuit.slug, lod), withMeshopt);

  const scene = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = shadows && lod === 'high';
      m.receiveShadow = shadows;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.map) std.map.anisotropy = lod === 'high' ? 4 : 1;
        // foliage / fences are alpha-tested cut-outs in the source
        if (std.transparent && std.alphaTest === 0) {
          std.alphaTest = 0.5;
          std.transparent = false;
        }
        std.side = THREE.DoubleSide;
      }
    });
    return root;
  }, [gltf, shadows, lod]);

  const pitOffset = pitLane?.offset;
  const pitWidth = pitLane?.width;
  const geos = useMemo(() => {
    const model = buildTrackModel(circuit, curve, {
      quality,
      trackWidth,
      minHalfWidth,
      pitLane: pitOffset != null && pitWidth != null ? { offset: pitOffset, width: pitWidth } : null,
      pitSpan,
    });
    const layout = buildLayout(model, quality);
    return {
      asphalt: buildAsphalt(model, layout),
      kerbs: buildKerbs(model, layout),
      lines: buildLines(model, layout, showSectors ? circuit.sectorSplits : null),
    };
  }, [circuit, curve, quality, trackWidth, minHalfWidth, pitOffset, pitWidth, pitSpan, showSectors]);

  const mats = useMemo(() => {
    const grain = asphaltTexture();
    if (grain) grain.repeat.set(1, 1);
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    return {
      grain,
      asphalt: std({ roughness: 0.78, metalness: 0.04, map: grain, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      kerbs: std({ roughness: 0.52, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      lines: std({ roughness: 0.44, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    };
  }, []);

  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  useEffect(
    () => () => {
      mats.grain?.dispose();
      mats.asphalt.dispose();
      mats.kerbs.dispose();
      mats.lines.dispose();
    },
    [mats],
  );

  return (
    <group>
      <hemisphereLight args={['#e8f2ff', '#2d3826', quality === 'high' ? 0.55 : 0.4]} />
      <primitive object={scene} />
      <mesh geometry={geos.asphalt} material={mats.asphalt} receiveShadow={shadows} />
      <mesh geometry={geos.kerbs} material={mats.kerbs} receiveShadow={shadows} />
      <mesh geometry={geos.lines} material={mats.lines} receiveShadow={shadows} />
    </group>
  );
}
