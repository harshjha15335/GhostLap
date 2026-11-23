import { lazy, Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { CircuitGeometry } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';
import { buildTrackModel, seedFrom, type Quality } from './trackModel';
import {
  asphaltTexture,
  buildAsphalt,
  buildBarriers,
  buildingGeometry,
  buildKerbs,
  buildLayout,
  buildLines,
  buildStructures,
  buildTerrain,
  buildVerges,
  scatterProps,
  treeGeometry,
} from './geometry';

const MelbourneEnvironment = lazy(() => import('./tracks/melbourne/MelbourneEnvironment'));

/**
 * Shared 3D circuit environment: a diorama block of terrain that follows the
 * track's elevation, the asphalt ribbon at its real (scaled) width, track-limit
 * lines, kerbs, gravel and paved run-off, barriers, pit lane + pit building,
 * grandstands, the start/finish gantry and instanced trees / building blocks.
 *
 * Hero circuits with dedicated OSM-aligned layers (starting with Melbourne / Albert Park)
 * are lazy-loaded per slug while keeping this component's props API identical.
 *
 * Layout approach inspired by Boxlane / F1TrackViewer (MIT); track widths from
 * the TUMFTM racetrack-database (LGPL-3.0) via the data pipeline.
 */
export interface CircuitEnvironmentProps {
  circuit: CircuitGeometry;
  curve: CircuitCurve;
  quality?: Quality;
  /** mean full track width in render units (real widths are scaled to it) */
  trackWidth?: number;
  /** minimum asphalt half-width (cars use fixed lane offsets) */
  minHalfWidth?: number;
  /** pit lane on the right of the main straight: centre offset + width (render units) */
  pitLane?: { offset: number; width: number } | null;
  /** lap fraction the pit lane covers either side of the line */
  pitSpan?: number;
  /** paint sector boundary lines */
  showSectors?: boolean;
  /** cast/receive shadows (needs <Canvas shadows>) */
  shadows?: boolean;
}

/** Street circuits get a built-up block instead of parkland (styling only). */
const STREET = new Set(['monte-carlo', 'singapore', 'baku', 'las-vegas', 'jeddah', 'madring', 'miami']);

export function CircuitEnvironment(props: CircuitEnvironmentProps) {
  if (props.circuit.slug === 'melbourne') {
    return (
      <Suspense fallback={null}>
        <MelbourneEnvironment {...props} />
        {import.meta.env.DEV && <RenderStatsProbe />}
      </Suspense>
    );
  }
  return <GenericCircuitEnvironment {...props} />;
}

function GenericCircuitEnvironment({
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
  const pitOffset = pitLane?.offset;
  const pitWidth = pitLane?.width;
  const built = useMemo(() => {
    const seed = seedFrom(circuit.slug);
    const urban = STREET.has(circuit.slug);
    const model = buildTrackModel(circuit, curve, {
      quality,
      trackWidth,
      minHalfWidth,
      pitLane: pitOffset != null && pitWidth != null ? { offset: pitOffset, width: pitWidth } : null,
      pitSpan,
    });
    const layout = buildLayout(model, quality);
    const terrain = buildTerrain(model, layout, { quality, seed, urban });
    const structures = buildStructures(model, layout, quality, seed);
    const props = scatterProps(model, layout, terrain, { quality, seed, urban });
    const geos = {
      terrain: terrain.geometry,
      verges: buildVerges(model, layout, seed),
      asphalt: buildAsphalt(model, layout),
      kerbs: buildKerbs(model, layout),
      lines: buildLines(model, layout, showSectors ? circuit.sectorSplits : null),
      barriers: buildBarriers(model, layout, terrain),
      structures: structures.geometry,
    };
    return { model, geos, props, lights: structures.lights };
  }, [circuit, curve, quality, trackWidth, minHalfWidth, pitOffset, pitWidth, pitSpan, showSectors]);

  const mats = useMemo(() => {
    const grain = asphaltTexture();
    if (grain) grain.repeat.set(1, 1);
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    return {
      grain,
      terrain: std({ roughness: 0.98, metalness: 0.02 }),
      verges: std({ roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      asphalt: std({ roughness: 0.78, metalness: 0.04, map: grain, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      kerbs: std({ roughness: 0.52, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      lines: std({ roughness: 0.44, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      walls: std({ roughness: 0.72, metalness: 0.12, side: THREE.DoubleSide }),
      trees: std({ roughness: 0.95, flatShading: true }),
      buildings: std({ roughness: 0.85, metalness: 0.08 }),
      lights: new THREE.MeshBasicMaterial({ color: '#ff1e1e', toneMapped: false }),
    };
  }, []);

  const instanced = useMemo(() => {
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
    const lights = new THREE.InstancedMesh(lightGeo, mats.lights, built.lights.length);
    const o = new THREE.Object3D();
    built.lights.forEach((p, i) => {
      o.position.set(p[0], p[1], p[2]);
      o.rotation.set(0, Math.atan2(built.model.tx[0], built.model.tz[0]), 0);
      o.scale.set(0.7 * M, 0.7 * M, 0.25 * M);
      o.updateMatrix();
      lights.setMatrixAt(i, o.matrix);
    });
    return {
      trees: make(treeGeometry(), mats.trees, built.props.trees),
      buildings: make(buildingGeometry(), mats.buildings, built.props.buildings),
      lights,
    };
  }, [built, mats, shadows]);

  useEffect(
    () => () => {
      Object.values(built.geos).forEach((g) => g.dispose());
    },
    [built],
  );
  useEffect(
    () => () => {
      instanced.trees.geometry.dispose();
      instanced.buildings.geometry.dispose();
      instanced.lights.geometry.dispose();
      instanced.trees.dispose();
      instanced.buildings.dispose();
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

  const { geos } = built;
  return (
    <group>
      {/* Ambient sky/ground daylight fill ensuring diorama is crisp and never a dark void */}
      <hemisphereLight args={['#e8f2ff', '#2d3826', quality === 'high' ? 0.55 : 0.4]} />
      <mesh geometry={geos.terrain} material={mats.terrain} receiveShadow={shadows} />
      <mesh geometry={geos.verges} material={mats.verges} receiveShadow={shadows} />
      <mesh geometry={geos.asphalt} material={mats.asphalt} receiveShadow={shadows} />
      <mesh geometry={geos.kerbs} material={mats.kerbs} receiveShadow={shadows} />
      <mesh geometry={geos.lines} material={mats.lines} receiveShadow={shadows} />
      <mesh geometry={geos.barriers} material={mats.walls} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={geos.structures} material={mats.walls} castShadow={shadows} receiveShadow={shadows} />
      <primitive object={instanced.trees} />
      <primitive object={instanced.buildings} />
      <primitive object={instanced.lights} />
      {import.meta.env.DEV && <RenderStatsProbe />}
    </group>
  );
}

/** Dev-only: exposes the renderer's per-frame counters as window.__ghostlapRender (for budgets / screenshots). */
function RenderStatsProbe() {
  useFrame(({ gl }) => {
    const w = window as unknown as { __ghostlapRender?: { calls: number; triangles: number; shadows: boolean } };
    w.__ghostlapRender = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, shadows: gl.shadowMap.enabled };
  });
  return null;
}

export default CircuitEnvironment;
