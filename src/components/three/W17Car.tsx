import { useEffect, useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { getPowerUnitGeometry, type MatKey } from './carGeometry';
import { EXPLODE_VECTORS, type CarPartId } from './carParts';
import { cancelTeamAtlasRequest, getLiveryTexture, requestTeamAtlas, type AtlasRes, type Livery } from './liveries';
import { useW17, W17_PART_NODES, type W17PartNode } from './w17';

/**
 * Renders the W17 model (see w17.ts) at one LOD. Geometry and the model's own materials are
 * shared by every instance; per instance only the clones' material slots change:
 *   - team livery: the painted bodywork ("mercedes_paint" / "mercedes_paint2") swaps to a
 *     shared per-team material whose map is the team atlas sampled through TEXCOORD_1
 *     (Mercedes keeps the model's original paint + sponsor decals; others hide those decals)
 *   - tyres: sidewall / tread lettering recoloured to the compound (tyreColor / tyreGlow)
 *   - number: the model's "63" number panels are redrawn for other car numbers
 *   - ghost: one translucent cyan material; highlight: a pulsing cyan material per part
 */

export const GHOST = new THREE.Color('#00F5D4');

const PAINT = new Set(['mercedes_paint', 'mercedes_paint2']);
const TYRE = new Set(['sidewall', 'tread_medium']);
const MERCEDES_DECALS = 'mercedes_decals';
const NUMBER = 'mercedes_number_63';

const NODE_PART: Record<W17PartNode, CarPartId> = {
  frontWing: 'frontWing',
  monocoque: 'monocoque',
  floor: 'floor',
  sidepodL: 'sidepods',
  sidepodR: 'sidepods',
  gearbox: 'gearbox',
  rearWing: 'rearWing',
};

/* ------------------------------------------------------------------ */
/* shared materials                                                    */
/* ------------------------------------------------------------------ */

let ghostMat: THREE.MeshStandardMaterial | null = null;
export function getGhostMaterial() {
  return (ghostMat ??= new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, depthWrite: false }));
}

/** channel-1 view of an atlas texture (same image / GPU upload, samples TEXCOORD_1) */
const channel1 = new WeakMap<THREE.Texture, THREE.Texture>();
function onChannel1(t: THREE.Texture) {
  let c = channel1.get(t);
  if (!c) {
    c = t.clone();
    c.channel = 1;
    c.needsUpdate = true;
    channel1.set(t, c);
  }
  return c;
}

/** team paint material = the model's paint material with the team atlas on UV set 1 (shared) */
const paintMats = new Map<string, THREE.Material>();
function teamPaint(base: THREE.MeshStandardMaterial, atlas: THREE.Texture): THREE.Material {
  const key = `${base.uuid}|${atlas.uuid}`;
  let m = paintMats.get(key);
  if (!m) {
    const c = base.clone() as THREE.MeshPhysicalMaterial;
    c.map = onChannel1(atlas);
    c.color.set('#ffffff');
    c.metalness = 0.32;
    c.roughness = 0.34;
    c.name = `${base.name}:team`;
    m = c;
    paintMats.set(key, m);
  }
  return m;
}

const lowMats = new Map<string, THREE.MeshStandardMaterial>();
function lowBody(atlas: THREE.Texture) {
  let m = lowMats.get(atlas.uuid);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: atlas, metalness: 0.3, roughness: 0.42, name: 'w17_low_body:team' });
    lowMats.set(atlas.uuid, m);
  }
  return m;
}

/* Number panels: the model's 1024×512 sheet (outlined nose/engine-cover "63"s + name badge) */
const numberTex = new Map<string, THREE.CanvasTexture>();
function getNumberTexture(n: number, accent: string) {
  const key = `${n}|${accent}`;
  let t = numberTex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // badge (top right)
  g.fillStyle = '#0b0d11';
  g.fillRect(580, 14, 404, 98);
  g.fillStyle = '#ffffff';
  g.font = 'bold 76px Anton, Impact, sans-serif';
  g.fillText(String(n), 782, 66);
  // big numbers (bottom left / bottom right)
  for (const [cx, stroke] of [
    [256, '#0b0d11'],
    [768, accent],
  ] as const) {
    g.font = 'bold 250px Anton, Impact, sans-serif';
    g.lineWidth = 22;
    g.strokeStyle = stroke;
    g.strokeText(String(n), cx, 340);
    g.fillStyle = '#ffffff';
    g.fillText(String(n), cx, 340);
  }
  t = new THREE.CanvasTexture(c);
  t.flipY = false; // glTF UV convention
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  numberTex.set(key, t);
  return t;
}

/** tyre material whose red Pirelli lettering takes the compound colour (+ glow) */
function makeTyreMaterial(base: THREE.MeshStandardMaterial) {
  const m = base.clone();
  const uniforms = { uTyre: { value: new THREE.Color('#FFD400') }, uGlow: { value: 1 } };
  m.userData.tyreUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTyre = uniforms.uTyre;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uTyre;\nuniform float uGlow;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float tyreMask = clamp((diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) * 4.0, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uTyre, tyreMask);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uTyre * tyreMask * uGlow;');
  };
  m.customProgramCacheKey = () => 'w17-tyre';
  return m;
}

/* procedural power unit (the W17 has no engine geometry) */
let puMats: Record<MatKey, THREE.Material> | null = null;
function getPuMaterials() {
  if (puMats) return puMats;
  const carbon = new THREE.MeshStandardMaterial({ color: '#14171c', metalness: 0.25, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.85, roughness: 0.28 });
  puMats = {
    body: metal,
    carbon,
    tyre: carbon,
    metal,
    ring: metal,
    ersCore: new THREE.MeshStandardMaterial({ color: '#0a1a1a', emissive: GHOST, emissiveIntensity: 0.6, toneMapped: false }),
    ersWarn: new THREE.MeshStandardMaterial({ color: '#1a0f05', emissive: new THREE.Color('#FF7A00'), emissiveIntensity: 0.7, toneMapped: false }),
  };
  return puMats;
}

/* ------------------------------------------------------------------ */
/* livery atlas hook                                                   */
/* ------------------------------------------------------------------ */

/**
 * The livery atlas for a car: explicit texture, else the team's baked atlas at `res`
 * (lazy, shared), else (while loading / unknown team / custom colours) the painted fallback.
 */
export function useLiveryAtlas(teamId: string | undefined, res: AtlasRes, liv: Required<Livery>, explicit?: THREE.Texture) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const team = explicit ? null : teamId ? requestTeamAtlas(teamId, res, bump) : null;
  useEffect(() => {
    if (!teamId || explicit) return;
    return () => cancelTeamAtlasRequest(teamId, res, bump);
  }, [teamId, res, explicit]);
  return explicit ?? team ?? getLiveryTexture(liv, res === 'sm');
}

/* ------------------------------------------------------------------ */
/* explodable part group                                               */
/* ------------------------------------------------------------------ */

export function PartGroup({ id, e, mirror = 1, onHover, children }: { id: CarPartId; e: number; mirror?: 1 | -1; onHover?: (id: CarPartId | null) => void; children: ReactNode }) {
  const v = EXPLODE_VECTORS[id];
  return (
    <group
      name={id}
      position={[v[0] * e * mirror, v[1] * e, v[2] * e]}
      onPointerOver={
        onHover
          ? (ev) => {
              ev.stopPropagation();
              onHover(id);
            }
          : undefined
      }
      onPointerOut={onHover ? () => onHover(null) : undefined}
    >
      {children}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* high / mid                                                          */
/* ------------------------------------------------------------------ */

export interface W17SplitProps {
  lod: 'high' | 'mid';
  /** eased explode amount 0..1 */
  e: number;
  highlight: Set<CarPartId>;
  onPartHover?: (id: CarPartId | null) => void;
  ghost: boolean;
  /** null = keep the model's own Mercedes paint + decals */
  atlas: THREE.Texture | null;
  number?: number;
  numberAccent: string;
  tyreColor: string;
  tyreGlow: number;
}

export function W17Split({ lod, e, highlight, onPartHover, ghost, atlas, number, numberAccent, tyreColor, tyreGlow }: W17SplitProps) {
  const gltf = useW17(lod);

  // per-instance clones of the part nodes (geometry + base materials shared)
  const nodes = useMemo(() => {
    const out = {} as Record<W17PartNode, THREE.Object3D>;
    for (const n of W17_PART_NODES) {
      const src = gltf.scene.getObjectByName(n);
      const c = src ? src.clone(true) : new THREE.Group();
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.userData.base = m.material;
      });
      out[n] = c;
    }
    return out;
  }, [gltf]);

  // per-instance materials
  const inst = useMemo(() => {
    const tyres = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    for (const n of W17_PART_NODES)
      nodes[n].traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const base = m.userData.base as THREE.MeshStandardMaterial;
        if (TYRE.has(base.name) && !tyres.has(base)) tyres.set(base, makeTyreMaterial(base));
      });
    const pulse = new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 1.2, transparent: true, opacity: 0.9, toneMapped: false });
    return { tyres, pulse, numbers: new Map<THREE.Material, THREE.MeshStandardMaterial>() };
  }, [nodes]);
  useEffect(
    () => () => {
      inst.tyres.forEach((m) => m.dispose());
      inst.numbers.forEach((m) => m.dispose());
      inst.pulse.dispose();
    },
    [inst],
  );

  const numberMap = number != null && !(atlas === null && number === 63) ? getNumberTexture(number, numberAccent) : null;

  useLayoutEffect(() => {
    const ghostM = getGhostMaterial();
    for (const n of W17_PART_NODES) {
      const hl = highlight.has(NODE_PART[n]);
      nodes[n].traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const base = mesh.userData.base as THREE.MeshStandardMaterial;
        const name = base.name;
        let mat: THREE.Material = base;
        let visible = true;
        if (name === MERCEDES_DECALS) visible = atlas === null && !ghost;
        else if (name === NUMBER) {
          visible = !ghost && (atlas === null || numberMap !== null);
          if (numberMap) {
            let nm = inst.numbers.get(base);
            if (!nm) {
              nm = base.clone();
              inst.numbers.set(base, nm);
            }
            if (nm.map !== numberMap) {
              const old = base.map;
              const t = numberMap;
              if (old) {
                t.offset.copy(old.offset);
                t.repeat.copy(old.repeat);
              }
              nm.map = t;
              nm.needsUpdate = true;
            }
            mat = nm;
          }
        } else if (TYRE.has(name)) mat = inst.tyres.get(base) ?? base;
        else if (atlas && PAINT.has(name)) mat = teamPaint(base, atlas);
        if (ghost) mat = ghostM;
        else if (hl && !TYRE.has(name)) mat = inst.pulse;
        mesh.material = mat;
        mesh.visible = visible;
      });
    }
  }, [nodes, inst, ghost, atlas, highlight, numberMap]);

  useLayoutEffect(() => {
    inst.tyres.forEach((m) => {
      const u = m.userData.tyreUniforms as { uTyre: { value: THREE.Color }; uGlow: { value: number } };
      u.uTyre.value.set(tyreColor);
      u.uGlow.value = 0.15 + tyreGlow * 1.6;
    });
  }, [inst, tyreColor, tyreGlow]);

  useFrame(({ clock }) => {
    if (highlight.size) inst.pulse.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 5) * 0.7;
  });

  const pu = e > 0.001 ? getPowerUnitGeometry() : null;
  const puMat = (k: MatKey, id: CarPartId) => (ghost ? getGhostMaterial() : highlight.has(id) ? inst.pulse : getPuMaterials()[k]);

  return (
    <>
      {W17_PART_NODES.map((n) => (
        <PartGroup key={n} id={NODE_PART[n]} e={e} mirror={n === 'sidepodL' ? -1 : 1} onHover={onPartHover}>
          <primitive object={nodes[n]} />
        </PartGroup>
      ))}
      {pu && (
        <>
          <PartGroup id="ice" e={e} onHover={onPartHover}>
            {pu.ice.map(({ mat, geo }, i) => (
              <mesh key={i} geometry={geo} material={puMat(mat, 'ice')} />
            ))}
          </PartGroup>
          <PartGroup id="ers" e={e} onHover={onPartHover}>
            {pu.ers.map(({ mat, geo }, i) => (
              <mesh key={i} geometry={geo} material={puMat(mat, 'ers')} />
            ))}
          </PartGroup>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* low: 2 draw calls (body + compound rings)                           */
/* ------------------------------------------------------------------ */

export function W17Low({ ghost, atlas, tyreColor, tyreGlow }: { ghost: boolean; atlas: THREE.Texture; tyreColor: string; tyreGlow: number }) {
  const gltf = useW17('low');
  const geo = useMemo(
    () => ({
      body: (gltf.scene.getObjectByName('body') as THREE.Mesh).geometry,
      rings: (gltf.scene.getObjectByName('rings') as THREE.Mesh).geometry,
    }),
    [gltf],
  );
  // compound ring: MeshStandardMaterial, toneMapped=false, userData.tyreRing = true
  // (the replay recolours it in place every few frames)
  const ring = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1, toneMapped: false });
    m.userData.tyreRing = true;
    return m;
  }, []);
  useEffect(() => () => ring.dispose(), [ring]);
  useLayoutEffect(() => {
    ring.color.set(tyreColor);
    ring.emissive.set(tyreColor);
    ring.emissiveIntensity = 0.4 + tyreGlow * 2.2;
  }, [ring, tyreColor, tyreGlow]);
  return (
    <>
      <mesh geometry={geo.body} material={ghost ? getGhostMaterial() : lowBody(atlas)} />
      <mesh geometry={geo.rings} material={ghost ? getGhostMaterial() : ring} />
    </>
  );
}
