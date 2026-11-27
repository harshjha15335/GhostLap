#!/usr/bin/env node
// Build the Race Lab safety car from Kenney's CC0 "Car Kit" (sedan-sports).
//
//   node scripts/models/build-safety-car.mjs
//
// Input : scripts/models/original/safety-car/sedan-sports.glb (+ Textures/colormap.png)
//         Kenney Car Kit 3.1, CC0 1.0 (see KENNEY-LICENSE.txt next to it)
// Output: public/models/safety-car/safety-car.glb
//         one primitive, one material, vertex colours (palette texture baked out),
//         red body swatches repainted to a neutral "safety car" silver, meshopt-compressed.
//
// The light bar and the "SAFETY CAR" lettering are added at runtime
// (src/components/replay/scene/SafetyCar.tsx), so no sponsor or maker logos are involved.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, 'original', 'safety-car', 'sedan-sports.glb');
const OUT_DIR = path.join(HERE, '..', '..', 'public', 'models', 'safety-car');
const OUT = path.join(OUT_DIR, 'safety-car.glb');

/** Kenney red/orange body swatches → silver; everything else keeps its palette colour. */
function repaint([r, g, b]) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  let h = 0;
  if (mx !== mn) {
    if (mx === r) h = ((g - b) / (mx - mn)) % 6;
    else if (mx === g) h = (b - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const reddish = sat > 0.35 && (h < 28 || h > 335);
  if (!reddish) return [r, g, b];
  const l = 0.62 + 0.38 * (mx / 255); // keep the swatch's gradient as a light → dark sheen
  return [196 * l, 202 * l, 212 * l];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
const doc = await io.read(SRC);
const root = doc.getRoot();

const tex = root.listTextures()[0];
const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sample = (u, v) => {
  const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
  const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
  const o = (y * info.width + x) * 4;
  return [data[o], data[o + 1], data[o + 2]];
};
const srgbToLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

const mat = doc.createMaterial('safetyCar').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.38).setMetallicFactor(0.25);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0');
    const n = uv.getCount();
    const col = new Float32Array(n * 3);
    const t = [0, 0];
    for (let i = 0; i < n; i++) {
      uv.getElement(i, t);
      const c = repaint(sample(t[0], t[1]));
      col[i * 3] = srgbToLinear(c[0]);
      col[i * 3 + 1] = srgbToLinear(c[1]);
      col[i * 3 + 2] = srgbToLinear(c[2]);
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(uv.getBuffer()));
    prim.setAttribute('TEXCOORD_0', null);
    prim.setAttribute('TANGENT', null);
    prim.setMaterial(mat);
  }
}
for (const m of root.listMaterials()) if (m !== mat) m.dispose();
tex.dispose();
root.listExtensionsUsed().forEach((e) => e.dispose());

await doc.transform(
  flatten(),
  join({ keepNamed: false, keepMeshes: false }),
  weld(),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10 }),
);
// one node for one primitive (join leaves one mesh per parent)
fs.mkdirSync(OUT_DIR, { recursive: true });
await io.write(OUT, doc);
let tris = 0;
let prims = 0;
for (const m of root.listMeshes())
  for (const p of m.listPrimitives()) {
    prims++;
    tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  }
console.log(`safety-car.glb  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB  tris ${tris}  primitives ${prims}`);
