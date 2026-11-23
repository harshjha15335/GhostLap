// Debug: write the part-split (uncompressed, full detail) W17 to scripts/models/.out/w17-split.glb
import fs from 'node:fs';
import { loadW17 } from './lib/load.mjs';
import { splitParts } from './lib/split.mjs';

const here = new URL('.', import.meta.url).pathname;
const { io, doc } = await loadW17(`${here}original/w17.glb`);
splitParts(doc);
fs.mkdirSync(`${here}.out`, { recursive: true });
await io.write(`${here}.out/w17-split.glb`, doc);
for (const n of doc.getRoot().listScenes()[0].listChildren()) {
  const prims = n.getMesh().listPrimitives();
  const tris = prims.reduce((a, p) => a + p.getIndices().getCount() / 3, 0);
  console.log(n.getName().padEnd(10), 'prims', prims.length, 'tris', tris);
}
