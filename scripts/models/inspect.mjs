// Print the node tree, primitives, materials and textures of a glTF/GLB.
// Usage: node scripts/models/inspect.mjs <file.glb>
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const f = (a) => a.map((v) => v.toFixed(2)).join(',');
console.log('scene bounds', JSON.stringify(getBounds(root.listScenes()[0])));
let totalTris = 0;
let prims = 0;
function walk(n, d = 0) {
  const m = n.getMesh();
  let s = `${'  '.repeat(d)}${n.getName()} t=${f(n.getTranslation())} r=${f(n.getRotation())} s=${f(n.getScale())}`;
  if (m) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      const tris = (idx ? idx.getCount() : pos.getCount()) / 3;
      totalTris += tris;
      prims++;
      s += `\n${'  '.repeat(d + 1)}prim mat=${p.getMaterial()?.getName()} tris=${tris} verts=${pos.getCount()} attrs=${p.listSemantics().join(',')} min=${f(pos.getMin([]))} max=${f(pos.getMax([]))}`;
    }
  }
  console.log(s);
  for (const c of n.listChildren()) walk(c, d + 1);
}
for (const n of root.listScenes()[0].listChildren()) walk(n);
const t = (x) => (x ? `${x.getName() || x.getURI()} ${x.getSize()?.join('x')} ${x.getMimeType()}` : '-');
for (const mat of root.listMaterials()) {
  console.log(
    'MAT',
    mat.getName(),
    'base',
    f(mat.getBaseColorFactor()),
    'alpha',
    mat.getAlphaMode(),
    'met',
    mat.getMetallicFactor(),
    'rough',
    mat.getRoughnessFactor(),
    '\n   baseTex',
    t(mat.getBaseColorTexture()),
    '| mr',
    t(mat.getMetallicRoughnessTexture()),
    '| n',
    t(mat.getNormalTexture()),
    '| e',
    t(mat.getEmissiveTexture()),
    '| o',
    t(mat.getOcclusionTexture()),
    'ext',
    mat.listExtensions().map((e) => e.extensionName).join(','),
  );
}
for (const tx of root.listTextures()) console.log('TEX', tx.getName(), tx.getURI(), tx.getSize()?.join('x'), tx.getMimeType(), tx.getImage().byteLength);
console.log('TOTAL tris', totalTris, 'primitives', prims, 'materials', root.listMaterials().length, 'textures', root.listTextures().length);
