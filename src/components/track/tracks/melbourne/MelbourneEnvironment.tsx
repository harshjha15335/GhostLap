import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { CircuitEnvironmentProps } from '../../CircuitEnvironment';
import { buildTrackModel, seedFrom } from '../../trackModel';
import {
  asphaltTexture,
  buildAsphalt,
  buildBarriers,
  buildKerbs,
  buildLayout,
  buildLines,
  buildVerges,
} from '../../geometry';
import { loadMelbourneEnv, melbourneAdsUrl, melbourneFacadesUrl } from './loadMelbourneEnv';
import {
  buildMelbourneAdsGeometry,
  buildMelbourneBuildings,
  buildMelbourneInstances,
  buildMelbourneStructures,
  buildMelbourneTerrain,
  buildMelbourneWater,
  buildParkOverlays,
  gumTreeGeometry,
  palmTreeGeometry,
  waterShimmerTexture,
} from './melbourneBuilders';
import type { AlbertParkEnvData } from './types';

/**
 * Hero 3D environment for Albert Park (Melbourne — Formula 1 Qatar Airways Australian Grand Prix 2026).
 */
export default function MelbourneEnvironment({
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
  const [env, setEnv] = useState<AlbertParkEnvData | null>(null);
  const [adsTex, setAdsTex] = useState<THREE.Texture | null>(null);
  const [facadesTex, setFacadesTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let alive = true;
    loadMelbourneEnv(quality)
      .then((data) => {
        if (alive) setEnv(data);
      })
      .catch(() => {
        // Non-fatal fallback
      });
    return () => {
      alive = false;
    };
  }, [quality]);

  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    let loadedAds: THREE.Texture | null = null;
    let loadedFac: THREE.Texture | null = null;

    loader.load(
      melbourneAdsUrl(quality),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = quality === 'high' ? 8 : 4;
        tex.needsUpdate = true;
        if (!alive) {
          tex.dispose();
          return;
        }
        loadedAds = tex;
        setAdsTex(tex);
      },
      undefined,
      () => {},
    );

    loader.load(
      melbourneFacadesUrl(quality),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = quality === 'high' ? 8 : 4;
        tex.needsUpdate = true;
        if (!alive) {
          tex.dispose();
          return;
        }
        loadedFac = tex;
        setFacadesTex(tex);
      },
      undefined,
      () => {},
    );

    return () => {
      alive = false;
      loadedAds?.dispose();
      loadedFac?.dispose();
    };
  }, [quality]);

  const pitOffset = pitLane?.offset;
  const pitWidth = pitLane?.width;

  const built = useMemo(() => {
    const seed = seedFrom(circuit.slug);
    const model = buildTrackModel(circuit, curve, {
      quality,
      trackWidth,
      minHalfWidth,
      pitLane: pitOffset != null && pitWidth != null ? { offset: pitOffset, width: pitWidth } : null,
      pitSpan,
    });
    const layout = buildLayout(model, quality);

    const asphalt = buildAsphalt(model, layout);
    const verges = buildVerges(model, layout, seed);
    const kerbs = buildKerbs(model, layout);
    const lines = buildLines(model, layout, showSectors ? circuit.sectorSplits : null);

    if (!env) {
      return {
        model,
        asphalt,
        verges,
        kerbs,
        lines,
        terrain: null,
        water: null,
        overlays: null,
        barriers: null,
        structures: null,
        buildingFacades: null,
        buildingRoofs: null,
        ads: null,
        instances: null,
        lights: [] as [number, number, number][],
      };
    }

    const terrain = buildMelbourneTerrain(model, layout, env, quality);
    const water = buildMelbourneWater(model, env);
    const overlays = buildParkOverlays(model, env);
    const barriers = buildBarriers(model, layout, terrain);
    const structures = buildMelbourneStructures(model, layout, env, quality);
    const buildings = buildMelbourneBuildings(model, terrain, env, quality);
    const ads = buildMelbourneAdsGeometry(model, layout, env);
    const instances = buildMelbourneInstances(model, terrain, env);

    return {
      model,
      asphalt,
      verges,
      kerbs,
      lines,
      terrain: terrain.geometry,
      water,
      overlays,
      barriers,
      structures: structures.geometry,
      buildingFacades: buildings.facades,
      buildingRoofs: buildings.roofs,
      ads,
      instances,
      lights: structures.lights,
    };
  }, [circuit, curve, quality, trackWidth, minHalfWidth, pitOffset, pitWidth, pitSpan, showSectors, env]);

  const mats = useMemo(() => {
    const grain = asphaltTexture();
    if (grain) grain.repeat.set(1, 1);
    const shimmer = waterShimmerTexture();
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    return {
      grain,
      shimmer,
      terrain: std({ roughness: 0.96, metalness: 0.02 }),
      water: new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: shimmer,
        roughness: 0.18,
        metalness: 0.12,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      overlays: std({ roughness: 0.92, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      verges: std({ roughness: 0.94, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      asphalt: std({ roughness: 0.78, metalness: 0.04, map: grain, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      kerbs: std({ roughness: 0.5, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      lines: std({ roughness: 0.42, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      walls: std({ roughness: 0.72, metalness: 0.12, side: THREE.DoubleSide }),
      trees: std({ roughness: 0.9, flatShading: true }),
      roofs: std({ roughness: 0.76, metalness: 0.1 }),
      lights: new THREE.MeshBasicMaterial({ color: '#ff1e1e', toneMapped: false }),
    };
  }, []);

  const adsMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: adsTex,
        roughness: 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    [adsTex],
  );

  const facadesMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: facadesTex,
        roughness: 0.46,
        metalness: 0.22,
      }),
    [facadesTex],
  );

  useFrame((_, delta) => {
    if (mats.shimmer) {
      mats.shimmer.offset.x = (mats.shimmer.offset.x + delta * 0.018) % 1;
      mats.shimmer.offset.y = (mats.shimmer.offset.y + delta * 0.011) % 1;
    }
  });

  const instanced = useMemo(() => {
    if (!built.instances) return null;
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, set: { matrices: THREE.Matrix4[]; colors: THREE.Color[] }) => {
      const count = Math.max(1, set.matrices.length);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      set.matrices.forEach((mx, i) => mesh.setMatrixAt(i, mx));
      set.colors.forEach((c, i) => mesh.setColorAt(i, c));
      mesh.count = set.matrices.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      return mesh;
    };

    const lightGeo = new THREE.BoxGeometry(1, 1, 1);
    const M = built.model.M;
    const lights = new THREE.InstancedMesh(lightGeo, mats.lights, Math.max(1, built.lights.length));
    const o = new THREE.Object3D();
    built.lights.forEach((p, i) => {
      o.position.set(p[0], p[1], p[2]);
      o.rotation.set(0, Math.atan2(built.model.tx[0], built.model.tz[0]), 0);
      o.scale.set(0.7 * M, 0.7 * M, 0.25 * M);
      o.updateMatrix();
      lights.setMatrixAt(i, o.matrix);
    });
    lights.count = built.lights.length;
    lights.instanceMatrix.needsUpdate = true;

    return {
      gums: make(gumTreeGeometry(), mats.trees, built.instances.gums),
      palms: make(palmTreeGeometry(), mats.trees, built.instances.palms),
      lights,
    };
  }, [built, mats, shadows]);

  useEffect(
    () => () => {
      built.asphalt.dispose();
      built.verges.dispose();
      built.kerbs.dispose();
      built.lines.dispose();
      built.terrain?.dispose();
      built.water?.dispose();
      built.overlays?.dispose();
      built.barriers?.dispose();
      built.structures?.dispose();
      built.buildingFacades?.dispose();
      built.buildingRoofs?.dispose();
      built.ads?.dispose();
    },
    [built],
  );

  useEffect(
    () => () => {
      if (!instanced) return;
      instanced.gums.geometry.dispose();
      instanced.palms.geometry.dispose();
      instanced.lights.geometry.dispose();
      instanced.gums.dispose();
      instanced.palms.dispose();
      instanced.lights.dispose();
    },
    [instanced],
  );

  useEffect(
    () => () => {
      mats.grain?.dispose();
      mats.shimmer?.dispose();
      Object.values(mats).forEach((m) => {
        if (m && m instanceof THREE.Material) m.dispose();
      });
    },
    [mats],
  );

  useEffect(() => () => adsMat.dispose(), [adsMat]);
  useEffect(() => () => facadesMat.dispose(), [facadesMat]);

  return (
    <group>
      <hemisphereLight args={['#eef6ff', '#4a6b38', quality === 'high' ? 0.65 : 0.45]} />
      {built.terrain && <mesh geometry={built.terrain} material={mats.terrain} receiveShadow={shadows} />}
      {built.water && <mesh geometry={built.water} material={mats.water} receiveShadow={shadows} />}
      {built.overlays && <mesh geometry={built.overlays} material={mats.overlays} receiveShadow={shadows} />}
      <mesh geometry={built.verges} material={mats.verges} receiveShadow={shadows} />
      <mesh geometry={built.asphalt} material={mats.asphalt} receiveShadow={shadows} />
      <mesh geometry={built.kerbs} material={mats.kerbs} receiveShadow={shadows} />
      <mesh geometry={built.lines} material={mats.lines} receiveShadow={shadows} />
      {built.barriers && <mesh geometry={built.barriers} material={mats.walls} castShadow={shadows} receiveShadow={shadows} />}
      {built.structures && <mesh geometry={built.structures} material={mats.walls} castShadow={shadows} receiveShadow={shadows} />}
      {built.buildingFacades && <mesh geometry={built.buildingFacades} material={facadesMat} castShadow={shadows} receiveShadow={shadows} />}
      {built.buildingRoofs && <mesh geometry={built.buildingRoofs} material={mats.roofs} castShadow={shadows} receiveShadow={shadows} />}
      {built.ads && adsTex && <mesh geometry={built.ads} material={adsMat} />}
      {instanced && <primitive object={instanced.gums} />}
      {instanced && <primitive object={instanced.palms} />}
      {instanced && <primitive object={instanced.lights} />}
    </group>
  );
}
