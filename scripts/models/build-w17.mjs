#!/usr/bin/env node
// Build GhostLap's W17 LODs from the original Sketchfab GLB.
//
//   node scripts/models/build-w17.mjs [high] [mid] [low]     (default: all three)
//
// Input : scripts/models/original/w17.glb  (CC-BY "2026 Mercedes W17" by Dave Love; NOT shipped)
// Output: public/models/w17-high.glb  hero / podium close-ups   (parts split, ~70k tris, ≤1024 WebP)
//         public/models/w17-mid.glb   podium / secondary views  (parts split, ~18k tris, ≤512 WebP)
//         public/models/w17-low.glb   22-car replay             (2 primitives, ~3k tris, no textures)
// See scripts/models/README.md.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { EXTTextureWebP, KHRMaterialsClearcoat, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { dedup, join, meshopt, prune, simplifyPrimitive, weld, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { loadW17, matName } from './lib/load.mjs';
import { splitParts } from './lib/split.mjs';
import { buildLow } from './lib/low.mjs';
import { addAtlasUV } from './lib/atlasuv.mjs';
import { sloppy } from './lib/low.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, 'original', 'w17.glb');
const OUT = path.join(HERE, '..', '..', 'public', 'models');

/** Materials that take the team livery (via TEXCOORD_1 into the team atlas). */
const PAINTED = ['mercedes_paint', 'mercedes_paint2'];

/** Cockpit / electronics bits that are invisible at our camera distances. */
const INTERIOR = ['generics_lcd', 'kers_red', 'kers_green', 'whitelight', 'CLEARLED', 'rev_lights', 'indicator_lights', 'sw_decals'];

/**
 * Per-LOD recipe. `keep` = fraction of triangles meshoptimizer may keep per material
 * (default `keepDefault`), `error` = max simplification error (relative to mesh extent),
 * `tex` = max texture edge per material (default `texDefault`), `normals` = materials that
 * keep their normal map.
 */
const LODS = {
  high: {
    drop: [...INTERIOR],
    keepDefault: 0.3,
    error: 0.004,
    keep: {
      mercedes_paint: 0.55,
      mercedes_paint2: 0.35,
      mercedes_decals: 1,
      mercedes_number_63: 1,
      mercedes_carbon3: 0.16,
      mercedes_carbon1: 0.26,
      mercedes_wheel_hub: 0.16,
      tread_medium: 0.2,
      sidewall: 0.6,
      gp21_cinture: 0.08,
      mercedes_sw: 0.08,
      sw_carbon: 0.1,
      chrome: 0.15,
      generics: 0.3,
      mercedes_detail: 0.35,
    },
    texDefault: 1024,
    tex: { mercedes_carbon1: 128, mercedes_carbon3: 128, sw_carbon: 128, gp21_cinture: 256, mercedes_sw: 256, rear_light_2: 256, generics: 512, mercedes_wheel_hub: 512 },
    normals: ['tread_medium', 'sidewall', 'mercedes_wheel_hub', 'mercedes_carbon1'],
    merge: { mercedes_carbon2: 'mercedes_carbon1', mercedes_carbon3: 'mercedes_carbon1', sw_carbon: 'mercedes_carbon1' },
    normalTex: 512,
    quality: 82,
  },
  mid: {
    drop: [...INTERIOR, 'gp21_cinture', 'mercedes_sw', 'sw_carbon', 'chrome', 'rear_light_2', 'mercedes_colordriver', 'discs', 'mercedes_mirror_left', 'mercedes_mirror_right'],
    // fewer draw calls: the carbon materials sample one texel each anyway (constant UVs) → one carbon
    merge: { mercedes_carbon2: 'mercedes_carbon1', mercedes_carbon3: 'mercedes_carbon1' },
    keepDefault: 0.08,
    error: 0.02,
    keep: {
      mercedes_paint: 0.14,
      mercedes_paint2: 0.08,
      mercedes_decals: 0.35,
      mercedes_number_63: 1,
      mercedes_carbon3: 0.03,
      mercedes_carbon1: 0.05,
      mercedes_wheel_hub: 0.025,
      tread_medium: 0.05,
      sidewall: 0.25,
      generics: 0.06,
      mercedes_detail: 0.08,
    },
    texDefault: 512,
    tex: { mercedes_carbon1: 64, mercedes_carbon3: 64, mercedes_carbon2: 128, generics: 256, mercedes_wheel_hub: 256, mercedes_detail: 256 },
    normals: [],
    sloppy: ['mercedes_wheel_hub', 'generics'],
    quality: 78,
  },
};

const fmt = (n) => (n / 1024).toFixed(0) + ' KB';

function countTris(doc) {
  let tris = 0;
  let prims = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
      prims++;
    }
  return { tris, prims };
}

async function encodeTextures(doc, recipe) {
  const root = doc.getRoot();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const seen = new Map();
  for (const mat of root.listMaterials()) {
    const name = matName(mat);
    if (!recipe.normals.includes(name) && mat.getNormalTexture()) mat.setNormalTexture(null);
    const slots = [
      [mat.getBaseColorTexture(), recipe.tex[name] ?? recipe.texDefault],
      [mat.getNormalTexture(), Math.min(recipe.normalTex ?? 512, recipe.tex[name] ?? recipe.texDefault)],
    ];
    for (const [tex, max] of slots) {
      if (!tex) continue;
      seen.set(tex, Math.max(seen.get(tex) ?? 0, max));
    }
  }
  await doc.transform(prune({ keepAttributes: true }));
  for (const [tex, max] of seen) {
    if (!root.listTextures().includes(tex)) continue;
    const img = sharp(Buffer.from(tex.getImage()));
    const meta = await img.metadata();
    const size = Math.min(max, meta.width ?? max);
    const buf = await img
      .resize(size, Math.round((size * (meta.height ?? size)) / (meta.width ?? size)), { fit: 'fill' })
      .webp({ quality: recipe.quality, alphaQuality: 90, effort: 6 })
      .toBuffer();
    tex.setImage(new Uint8Array(buf)).setMimeType('image/webp');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.\w+$/, '.webp'));
  }
}

async function buildSplitLOD(name) {
  const recipe = LODS[name];
  const { io, doc } = await loadW17(SRC);
  const root = doc.getRoot();
  // drop materials this LOD doesn't need
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives()) if (recipe.drop.includes(matName(p.getMaterial()))) p.dispose();
  await doc.transform(prune());
  // simplify each primitive with its own budget (before the split, so islands stay whole)
  await doc.transform(weld());
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives()) {
      const keep = recipe.keep[matName(p.getMaterial())] ?? recipe.keepDefault;
      if (keep >= 1) continue;
      const n0 = p.getIndices().getCount() / 3;
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: keep, error: recipe.error, lockBorder: false });
      compactPrimitive(p);
      // pieces made of many small islands stall the topology-preserving simplifier
      if (recipe.sloppy?.includes(matName(p.getMaterial())) && p.getIndices().getCount() / 3 > n0 * keep * 1.5) sloppy(p, Math.round(n0 * keep));
    }
  // team livery UVs (TEXCOORD_1) on the painted bodywork
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives()) if (PAINTED.includes(matName(p.getMaterial()))) addAtlasUV(doc, p);
  if (recipe.merge) {
    const byName = new Map(root.listMaterials().map((m) => [matName(m), m]));
    for (const mesh of root.listMeshes())
      for (const p of mesh.listPrimitives()) {
        const to = recipe.merge[matName(p.getMaterial())];
        if (to && byName.get(to)) p.setMaterial(byName.get(to));
      }
  }
  splitParts(doc);
  // one primitive per (part, material)
  await doc.transform(join({ keepNamed: true }));
  // lighter shading extensions for the mid LOD
  if (name !== 'high') {
    for (const mat of root.listMaterials()) {
      mat.setExtension('KHR_materials_clearcoat', null);
      mat.setExtension('KHR_materials_specular', null);
    }
    root.listExtensionsUsed().filter((e) => e instanceof KHRMaterialsClearcoat || e instanceof KHRMaterialsSpecular).forEach((e) => e.dispose());
  }
  for (const mat of root.listMaterials()) mat.setName(matName(mat));
  await encodeTextures(doc, recipe);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true }),
    // reorders + quantizes (position 14 / normal 10 / uv 12 bits; adds node scale/offset) + compresses
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  const file = path.join(OUT, `w17-${name}.glb`);
  await io.write(file, doc);
  const { tris, prims } = countTris(doc);
  console.log(`w17-${name}.glb  ${fmt(fs.statSync(file).size)}  tris ${tris}  primitives ${prims}  materials ${root.listMaterials().length}  textures ${root.listTextures().length}`);
}

const which = process.argv.slice(2);
const want = which.length ? which : ['high', 'mid', 'low'];
fs.mkdirSync(OUT, { recursive: true });
for (const lod of want) {
  if (lod === 'low') await buildLow(SRC, path.join(OUT, 'w17-low.glb'));
  else await buildSplitLOD(lod);
}
