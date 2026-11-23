// Re-organise a flat W17 document into one node per sub-assembly (PART_IDS), each holding
// one primitive per material.
import { compactPrimitive } from '@gltf-transform/functions';
import { matName } from './load.mjs';
import { triangleIslands, islandStats } from './mesh.mjs';
import { PART_IDS, classifyTriangles } from './parts.mjs';

export function splitParts(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const buffer = root.listBuffers()[0];
  const partMesh = Object.fromEntries(PART_IDS.map((id) => [id, doc.createMesh(id)]));
  const oldNodes = scene.listChildren();
  for (const node of oldNodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = matName(prim.getMaterial());
      const pos = prim.getAttribute('POSITION').getArray();
      const idx = prim.getIndices().getArray();
      const isl = triangleIslands(pos, idx);
      const st = islandStats(pos, idx, isl);
      const parts = classifyTriangles(pos, idx, isl, st, mat);
      const byPart = new Map();
      for (let t = 0; t < parts.length; t++) {
        let l = byPart.get(parts[t]);
        if (!l) byPart.set(parts[t], (l = []));
        l.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
      }
      for (const [part, list] of byPart) {
        const p = prim.clone();
        const maxV = pos.length / 3;
        const arr = maxV > 65535 ? new Uint32Array(list) : new Uint16Array(list);
        p.setIndices(doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer));
        compactPrimitive(p);
        partMesh[part].addPrimitive(p);
      }
    }
    mesh.dispose();
    node.dispose();
  }
  for (const id of PART_IDS) {
    if (partMesh[id].listPrimitives().length) scene.addChild(doc.createNode(id).setMesh(partMesh[id]));
    else partMesh[id].dispose();
  }
  return doc;
}
