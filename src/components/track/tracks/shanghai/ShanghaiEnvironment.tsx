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
import type { CircuitEnvData } from '../shared/types';
import { loadShanghaiEnv, shanghaiAdsUrl, shanghaiFacadesUrl } from './loadShanghaiEnv';
import {
  buildShanghaiAdsGeometry,
  buildShanghaiBuildings,
  buildShanghaiOverlays,
  buildShanghaiStructures,
  buildShanghaiTerrain,
  buildShanghaiTreeInstances,
  buildShanghaiWater,
  createShanghaiWaterMaterial,
  shanghaiTreeGeometry,
} from './shanghaiBuilders';

/**
 * Hero 3D environment for Shanghai International Circuit (Formula 1 Heineken Chinese Grand Prix 2026).
 */
export default function ShanghaiEnvironment({
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
  const [env, setEnv] = useState<CircuitEnvData | null>(null);
  const [adsTex, setAdsTex] = useState<THREE.Texture | null>(null);
  const [facadesTex, setFacadesTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let alive = true;
    loadShanghaiEnv(quality)
      .then((data) => {
        if (alive) setEnv(data);
      })
      .catch(() => {});
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
      shanghaiAdsUrl(quality),
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
      shanghaiFacadesUrl(quality),
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
        trees: null,
        lights: [] as [number, number, number][],
      };
    }

    const terrain = buildShanghaiTerrain(model, layout, env, quality);
    const water = buildShanghaiWater(model, env, quality);
    const overlays = buildShanghaiOverlays(model, env);
    const barriers = buildBarriers(model, layout, terrain);
    const structures = buildShanghaiStructures(model, layout, env, quality);
    const buildings = buildShanghaiBuildings(model, terrain, env, quality);
    const ads = buildShanghaiAdsGeometry(model, layout, env);
    const trees = buildShanghaiTreeInstances(model, terrain, env);

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
      trees,
      lights: structures.lights,
    };
  }, [circuit, curve, quality, trackWidth, minHalfWidth, pitOffset, pitWidth, pitSpan, showSectors, env]);

  const mats = useMemo(() => {
    const grain = asphaltTexture();
    if (grain) grain.repeat.set(1, 1);
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    return {
      grain,
      terrain: std({ roughness: 0.96, metalness: 0.02 }),
      water: createShanghaiWaterMaterial(),
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
    mats.water.uniforms.uTime.value += delta;
  });

  const instanced = useMemo(() => {
    if (!built.trees) return null;
    const count = Math.max(1, built.trees.matrices.length);
    const treeMesh = new THREE.InstancedMesh(shanghaiTreeGeometry(), mats.trees, count);
    built.trees.matrices.forEach((mx, i) => treeMesh.setMatrixAt(i, mx));
    built.trees.colors.forEach((c, i) => treeMesh.setColorAt(i, c));
    treeMesh.count = built.trees.matrices.length;
    treeMesh.instanceMatrix.needsUpdate = true;
    if (treeMesh.instanceColor) treeMesh.instanceColor.needsUpdate = true;
    treeMesh.computeBoundingSphere();
    treeMesh.castShadow = shadows;
    treeMesh.receiveShadow = shadows;

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

    return { trees: treeMesh, lights };
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
      instanced.trees.geometry.dispose();
      instanced.lights.geometry.dispose();
      instanced.trees.dispose();
      instanced.lights.dispose();
    },
    [instanced],
  );

  useEffect(
    () => () => {
      mats.grain?.dispose();
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
      {built.water && <mesh geometry={built.water} material={mats.water} />}
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
      {instanced && <primitive object={instanced.trees} />}
      {instanced && <primitive object={instanced.lights} />}
    </group>
  );
}
