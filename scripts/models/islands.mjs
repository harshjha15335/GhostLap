// Debug: list the connected islands of every material of the (normalised) W17.
// Usage: node scripts/models/islands.mjs [minTris]
import { getBounds } from '@gltf-transform/core';
import { loadW17, matName } from './lib/load.mjs';
import { triangleIslands, islandStats } from './lib/mesh.mjs';

const minTris = Number(process.argv[2] ?? 200);
const { doc } = await loadW17(new URL('./original/w17.glb', import.meta.url).pathname);
console.log('bounds', JSON.stringify(getBounds(doc.getRoot().listScenes()[0])));
const f = (a) => a.map((v) => v.toFixed(2)).join(',');
for (const mesh of doc.getRoot().listMeshes()) {
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray();
    const idx = p.getIndices().getArray();
    const isl = triangleIslands(pos, idx);
    const st = islandStats(pos, idx, isl);
    const big = st.map((s, i) => ({ ...s, i })).filter((s) => s.tris >= minTris).sort((a, b) => b.tris - a.tris);
    console.log(`\n${matName(p.getMaterial())}: ${idx.length / 3} tris, ${isl.count} islands, ${big.length} with >= ${minTris} tris`);
    for (const s of big.slice(0, 40)) console.log(`  #${s.i} tris=${s.tris} min=${f(s.min)} max=${f(s.max)} c=${f(s.c)}`);
  }
}
