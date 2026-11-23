// w17-low.glb — the 22-car replay LOD.
//
// Two primitives, two materials, no textures:
//   node "body"  : the whole car decimated to ~3k triangles, UVs into the LIVERY_ATLAS layout
//                  (painted surfaces get planar projections, everything else the flat
//                  "underside" carbon cell), so each team's existing public/liveries/<team>-sm.webp
//                  atlas skins it at runtime. TEXCOORD_0 is stored for a flipY=true texture
//                  (three's TextureLoader default, as used by requestTeamLiveryTexture).
//   node "rings" : flat compound-colour bands on the outer tyre sidewalls (material "tyre_ring").
import fs from 'node:fs';
import { getBounds } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, quantize, reorder, simplifyPrimitive, weld, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { loadW17, matName } from './load.mjs';
import { triangleIslands, islandStats, triNormal } from './mesh.mjs';
import { regionAt, atlasCoord } from './atlas.mjs';

const PAINT = new Set(['mercedes_paint', 'mercedes_paint2']);
const KEEP = new Set(['mercedes_paint', 'mercedes_paint2', 'mercedes_carbon1', 'mercedes_carbon3', 'mercedes_carbon2', 'mercedes_detail', 'mercedes_wheel_hub', 'tread_medium', 'sidewall']);
/** triangle budget per material (meshoptimizer target; the error bound decides the rest) */
const BUDGET = {
  mercedes_paint: 1250,
  mercedes_paint2: 60,
  mercedes_carbon3: 520,
  mercedes_carbon1: 560,
  mercedes_carbon2: 24,
  mercedes_detail: 120,
  mercedes_wheel_hub: 160,
  tread_medium: 300,
  sidewall: 120,
};
/** islands smaller than this (bbox diagonal, metres) vanish at replay distances */
const MIN_ISLAND = { default: 0.18, mercedes_paint: 0.08, tread_medium: 0, sidewall: 0, mercedes_wheel_hub: 0.3 };

const WHEELS = [
  { x: 0.955, z: 1.62, r: 0.355 },
  { x: -0.955, z: 1.62, r: 0.355 },
  { x: 0.945, z: -1.78, r: 0.355 },
  { x: -0.945, z: -1.78, r: 0.355 },
];

function dropSmallIslands(doc, prim, mat) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const isl = triangleIslands(pos, idx);
  const st = islandStats(pos, idx, isl);
  const min = MIN_ISLAND[mat] ?? MIN_ISLAND.default;
  const keep = st.map((s) => Math.hypot(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]) >= min);
  const out = [];
  for (let t = 0; t < idx.length / 3; t++) if (keep[isl.tri[t]]) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  prim.getIndices().setArray(pos.length / 3 > 65535 ? new Uint32Array(out) : new Uint16Array(out));
  compactPrimitive(prim);
}

/** meshoptimizer's topology-ignoring simplifier, for pieces made of many tiny islands */
export function sloppy(prim, target) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx), pos, 3, null, target * 3, 0.05);
  prim.getIndices().setArray(pos.length / 3 > 65535 ? new Uint32Array(out) : new Uint16Array(out));
  compactPrimitive(prim);
}

export async function buildLow(src, file) {
  const { io, doc } = await loadW17(src);
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) if (!KEEP.has(matName(p.getMaterial()))) p.dispose();
  await doc.transform(prune(), weld());

  // decimate every material to its budget
  const tris = [];
  const P = [0, 0, 0];
  const N = [0, 0, 0];
  const uv = [0, 0];
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const mat = matName(prim.getMaterial());
      dropSmallIslands(doc, prim, mat);
      const n0 = prim.getIndices().getCount() / 3;
      const ratio = Math.min(1, (BUDGET[mat] ?? 100) / n0);
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.25, lockBorder: false });
      compactPrimitive(prim);
      if (prim.getIndices().getCount() / 3 > (BUDGET[mat] ?? 100) * 1.4) sloppy(prim, BUDGET[mat] ?? 100);
      const pos = prim.getAttribute('POSITION').getArray();
      const idx = prim.getIndices().getArray();
      const paint = PAINT.has(mat);
      for (let t = 0; t < idx.length / 3; t++) {
        const a = idx[t * 3];
        const b = idx[t * 3 + 1];
        const c = idx[t * 3 + 2];
        triNormal(pos, a, b, c, N);
        for (let k = 0; k < 3; k++) P[k] = (pos[a * 3 + k] + pos[b * 3 + k] + pos[c * 3 + k]) / 3;
        const region = paint ? regionAt(P, N) : 'underside';
        const corners = [a, b, c].map((v) => {
          const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
          atlasCoord(region, p, uv);
          return { p, uv: [uv[0], 1 - uv[1]] };
        });
        tris.push({ corners, n: [...N] });
      }
      console.log(`  low ${mat.padEnd(20)} ${n0} -> ${idx.length / 3}`);
    }

  // one flat-shaded-ish body primitive: shared vertices only where position+uv match
  // (normals are averaged over those to keep it smooth inside each atlas region)
  const key = new Map();
  const vp = [];
  const vn = [];
  const vt = [];
  const ix = [];
  for (const tri of tris) {
    for (const c of tri.corners) {
      const k = `${c.p.map((x) => Math.round(x * 2000)).join(',')}|${Math.round(c.uv[0] * 4096)},${Math.round(c.uv[1] * 4096)}`;
      let i = key.get(k);
      if (i === undefined) {
        i = vp.length / 3;
        key.set(k, i);
        vp.push(...c.p);
        vn.push(0, 0, 0);
        vt.push(...c.uv);
      }
      vn[i * 3] += tri.n[0];
      vn[i * 3 + 1] += tri.n[1];
      vn[i * 3 + 2] += tri.n[2];
      ix.push(i);
    }
  }
  for (let i = 0; i < vn.length; i += 3) {
    const l = Math.hypot(vn[i], vn[i + 1], vn[i + 2]) || 1;
    vn[i] /= l;
    vn[i + 1] /= l;
    vn[i + 2] /= l;
  }

  // fresh document with just the two primitives
  for (const n of root.listScenes()[0].listChildren()) n.dispose();
  for (const m of root.listMeshes()) m.dispose();
  for (const m of root.listMaterials()) m.dispose();
  await doc.transform(prune({ keepAttributes: true }));
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const bodyMat = doc.createMaterial('w17_low_body').setBaseColorFactor([0.8, 0.82, 0.84, 1]).setMetallicFactor(0.3).setRoughnessFactor(0.45);
  const body = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(vp)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(vn)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(vt)))
    .setIndices(acc('SCALAR', vp.length / 3 > 65535 ? new Uint32Array(ix) : new Uint16Array(ix)))
    .setMaterial(bodyMat);

  // compound rings: annulus r 0.2..0.3 on each outer sidewall, facing outward
  const SEG = 18;
  const rp = [];
  const rn = [];
  const ri = [];
  for (const w of WHEELS) {
    const s = Math.sign(w.x);
    const base = rp.length / 3;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      for (const r of [0.2, 0.3]) {
        rp.push(w.x + s * 0.004, w.r + Math.sin(a) * r, w.z + Math.cos(a) * r);
        rn.push(s, 0, 0);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      const a0 = base + i * 2;
      const a1 = base + i * 2 + 1;
      const b0 = base + j * 2;
      const b1 = base + j * 2 + 1;
      // winding so the face normal points along +s·x
      if (s > 0) ri.push(a0, b0, a1, a1, b0, b1);
      else ri.push(a0, a1, b0, a1, b1, b0);
    }
  }
  const ringMat = doc.createMaterial('tyre_ring').setBaseColorFactor([1, 0.83, 0, 1]).setMetallicFactor(0).setRoughnessFactor(0.5);
  const rings = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(rp)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(rn)))
    .setIndices(acc('SCALAR', new Uint16Array(ri)))
    .setMaterial(ringMat);
  const scene = root.listScenes()[0];
  scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(body)));
  scene.addChild(doc.createNode('rings').setMesh(doc.createMesh('rings').addPrimitive(rings)));
  // positions stay float (identity node transforms → the geometry can be instanced as-is)
  await doc.transform(
    prune({ keepAttributes: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TEXCOORD_0)$/, quantizeNormal: 8, quantizeTexcoord: 12 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(file, doc);
  console.log(`w17-low.glb  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  tris ${ix.length / 3 + ri.length / 3} (body ${ix.length / 3}, rings ${ri.length / 3})  verts ${vp.length / 3}  bounds ${JSON.stringify(getBounds(scene).max.map((v) => +v.toFixed(2)))}`);
}
