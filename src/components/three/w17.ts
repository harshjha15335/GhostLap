import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, MeshoptDecoder, type GLTF } from 'three-stdlib';

/**
 * Lazy W17 model loading (CC-BY "2026 Mercedes W17" by Dave Love, see public/models/CREDITS.md).
 *
 * Three LODs are built by scripts/models/build-w17.mjs into public/models/:
 *   high  ~78k tris, 7 part nodes, original materials + WebP textures   (hero, turntable, exploded)
 *   mid   ~20k tris, 7 part nodes, ≤512 textures                       (podium, secondary views)
 *   low   ~3.4k tris, 2 primitives, no textures                         (22-car replay, S-curve)
 * Nothing is preloaded: a GLB is fetched the first time a component asks for that LOD, so
 * pages without a car download none. Meshopt-compressed; the decoder is bundled (no CDN).
 */
export type W17Lod = 'high' | 'mid' | 'low';

export const w17Url = (lod: W17Lod) => `${import.meta.env.BASE_URL}models/w17-${lod}.glb`;

/** Part nodes of the high / mid GLBs (sidepods are split per side). */
export const W17_PART_NODES = ['frontWing', 'monocoque', 'floor', 'sidepodL', 'sidepodR', 'gearbox', 'rearWing'] as const;
export type W17PartNode = (typeof W17_PART_NODES)[number];

type Entry = { promise: Promise<GLTF>; gltf?: GLTF; error?: unknown };
const cache = new Map<W17Lod, Entry>();
let loader: GLTFLoader | null = null;

/** Start (or reuse) the load of one LOD. */
export function loadW17(lod: W17Lod): Promise<GLTF> {
  let e = cache.get(lod);
  if (!e) {
    if (!loader) {
      loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder());
    }
    const entry: Entry = {
      promise: loader.loadAsync(w17Url(lod)).then(
        (g) => {
          entry.gltf = g;
          prepare(lod, g);
          return g;
        },
        (err) => {
          entry.error = err;
          throw err;
        },
      ),
    };
    entry.promise.catch(() => undefined);
    e = entry;
    cache.set(lod, entry);
  }
  return e.promise;
}

/** Suspends (throws the pending promise) until the LOD is loaded; throws its error on failure. */
export function useW17(lod: W17Lod): GLTF {
  loadW17(lod);
  const e = cache.get(lod)!;
  if (e.gltf) return e.gltf;
  if (e.error) throw e.error;
  throw e.promise;
}

/** One-time per-LOD fix-ups on the shared source scene. */
function prepare(lod: W17Lod, g: GLTF) {
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (lod === 'high') {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.map) mat.map.anisotropy = lod === 'high' ? 8 : 4;
    // the model's paint is authored metallic 0.8 for an HDRI viewer; our studio scenes have no
    // environment map, where that reads near-black — soften it (same look, lit by our lights)
    if (mat.name === 'mercedes_paint' || mat.name === 'mercedes_paint2') {
      mat.metalness = 0.45;
      mat.roughness = 0.3;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Instanced low-LOD geometry (S-curve flow etc.)                      */
/* ------------------------------------------------------------------ */

/**
 * The low-LOD car as ONE BufferGeometry (body + compound rings) with a `color` attribute
 * for instanced / vertex-coloured use: painted bodywork white (tinted by instance colour),
 * carbon / tyres near-black, rings white. Resolves after the 43 KB low GLB arrives; the
 * caller owns (and disposes) the returned geometry.
 */
export async function loadW17InstanceGeometry(): Promise<THREE.BufferGeometry> {
  const g = await loadW17('low');
  const body = (g.scene.getObjectByName('body') as THREE.Mesh).geometry;
  const rings = (g.scene.getObjectByName('rings') as THREE.Mesh).geometry;
  const parts = [body, rings].map((src, k) => {
    const geo = new THREE.BufferGeometry();
    const pos = src.getAttribute('position');
    const nrm = src.getAttribute('normal');
    const n = pos.count;
    const p = new Float32Array(n * 3);
    const nn = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = src.getAttribute('uv');
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.getX(i);
      p[i * 3 + 1] = pos.getY(i);
      p[i * 3 + 2] = pos.getZ(i);
      nn[i * 3] = nrm.getX(i);
      nn[i * 3 + 1] = nrm.getY(i);
      nn[i * 3 + 2] = nrm.getZ(i);
      // underside / carbon cell of the atlas (x 960..1008 of 1024, top rows) → carbon
      let c = 1;
      if (k === 0 && uv) {
        const u = uv.getX(i);
        const v = 1 - uv.getY(i);
        if (u > 0.93 && u < 0.99 && v > 0.22 && v < 0.33) c = 0.06;
      }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx = src.getIndex()!;
    geo.setIndex(Array.from(idx.array as ArrayLike<number>));
    return geo;
  });
  // merge the two (indices offset)
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = parts[0].getAttribute(name).array as Float32Array;
    const b = parts[1].getAttribute(name).array as Float32Array;
    const m = new Float32Array(a.length + b.length);
    m.set(a);
    m.set(b, a.length);
    out.setAttribute(name, new THREE.BufferAttribute(m, 3));
  }
  const n0 = parts[0].getAttribute('position').count;
  const i0 = Array.from(parts[0].getIndex()!.array as ArrayLike<number>);
  const i1 = Array.from(parts[1].getIndex()!.array as ArrayLike<number>).map((i) => i + n0);
  out.setIndex([...i0, ...i1]);
  out.computeBoundingSphere();
  parts.forEach((p) => p.dispose());
  return out;
}

/** Non-suspending hook: the instanced low-LOD geometry, or null until it has loaded. */
export function useW17InstanceGeometry(): THREE.BufferGeometry | null {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let live = true;
    let made: THREE.BufferGeometry | null = null;
    loadW17InstanceGeometry().then(
      (g) => {
        made = g;
        if (live) setGeo(g);
        else g.dispose();
      },
      () => undefined,
    );
    return () => {
      live = false;
      made?.dispose();
    };
  }, []);
  return geo;
}
