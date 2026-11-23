// Give a painted primitive a second UV set (TEXCOORD_1) into the LIVERY_ATLAS layout.
//
// The W17's own paint UVs overlap (mirrored halves share texels, two UV tiles), so team
// liveries can't be baked into them. Instead every painted triangle gets a planar
// projection into the shared team atlas (public/liveries/<team>.webp): the region is chosen
// per triangle (face normal + centroid, lib/atlas.mjs) and vertices are split where
// neighbouring triangles use different regions. v is stored for a flipY=true texture.
import { regionAt, atlasCoord } from './atlas.mjs';
import { triNormal } from './mesh.mjs';

export function addAtlasUV(doc, prim) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const nt = idx.length / 3;
  const N = [0, 0, 0];
  const C = [0, 0, 0];
  const uv = [0, 0];
  const map = new Map(); // `${vertex}|${region}` → new vertex
  const src = []; // new vertex → old vertex
  const uv1 = [];
  const newIdx = new Uint32Array(idx.length);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3];
    const b = idx[t * 3 + 1];
    const c = idx[t * 3 + 2];
    triNormal(pos, a, b, c, N);
    for (let k = 0; k < 3; k++) C[k] = (pos[a * 3 + k] + pos[b * 3 + k] + pos[c * 3 + k]) / 3;
    const region = regionAt(C, N);
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      const key = `${v}|${region}`;
      let nv = map.get(key);
      if (nv === undefined) {
        nv = src.length;
        map.set(key, nv);
        src.push(v);
        atlasCoord(region, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], uv);
        uv1.push(uv[0], 1 - uv[1]);
      }
      newIdx[t * 3 + k] = nv;
    }
  }
  // re-gather every existing attribute through `src`
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    const el = acc.getElementSize();
    const old = acc.getArray();
    const arr = new old.constructor(src.length * el);
    for (let i = 0; i < src.length; i++) for (let k = 0; k < el; k++) arr[i * el + k] = old[src[i] * el + k];
    prim.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(arr).setNormalized(acc.getNormalized()).setBuffer(acc.getBuffer()));
  }
  prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv1)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(src.length > 65535 ? newIdx : new Uint16Array(newIdx)).setBuffer(prim.getIndices().getBuffer()));
  return { vertices: src.length };
}
