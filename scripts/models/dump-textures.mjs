// Dump every material's textures of a GLB to a folder (debug helper for the livery work).
// Usage: node scripts/models/dump-textures.mjs <file.glb> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , file, out] = process.argv;
fs.mkdirSync(out, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
for (const mat of doc.getRoot().listMaterials()) {
  const slots = { base: mat.getBaseColorTexture(), normal: mat.getNormalTexture(), mr: mat.getMetallicRoughnessTexture() };
  for (const [k, tex] of Object.entries(slots)) {
    if (!tex) continue;
    const ext = tex.getMimeType() === 'image/png' ? 'png' : tex.getMimeType().split('/')[1];
    fs.writeFileSync(path.join(out, `${mat.getName().replace(/\.\d+$/, '')}.${k}.${ext}`), tex.getImage());
  }
}
console.log('done');
