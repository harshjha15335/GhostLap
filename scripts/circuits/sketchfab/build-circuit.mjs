// Bake a third-party (Sketchfab) circuit scene into GhostLap's frame and compress it.
//
//   node scripts/circuits/sketchfab/build-circuit.mjs <slug> [high|low ...]
//
// Source:  scripts/circuits/source/<slug>/scene.gltf (+ scene.bin, textures/) — not committed
// Fit:     scripts/circuits/sketchfab/<slug>.align.json (from align.py)
// Config:  scripts/circuits/sketchfab/circuits.json
// Output:  public/models/circuits/<slug>/<slug>-{high,low}.glb
//
// Every vertex is moved by the fitted similarity transform, then by a smooth warp built from
// the residuals along the racing line, so the model's road sits under GhostLap's cars. The
// model keeps its true vertical scale; the warp absorbs GhostLap's exaggerated relief.
// Geometry that would stand on GhostLap's (wider than real) asphalt + kerbs — barriers,
// fences, signs a few metres tall — is cut away; ground and bridges are kept. The app draws
// its own asphalt, kerbs and lines on top.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dedup, join, meshopt, prune, simplifyPrimitive, weld, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { makeIO } from '../../models/lib/load.mjs';
import { sloppy } from '../../models/lib/low.mjs';
import { triangleIslands } from '../../models/lib/mesh.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..', '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'circuits.json'), 'utf8'));

/** Half-width (render units) around the racing line that GhostLap's asphalt + kerbs cover. */
const CLEAR_HALF = 2.35;
/** Heights above the line that count as "standing on the track" (bridges are higher). */
const CLEAR_MIN_H = 0.08;
const CLEAR_MAX_H = 0.8;
/** The model sits this far below GhostLap's asphalt so the app's road always wins. */
const SINK = 0.05;

const LODS = {
  high: { texBig: 512, texSmall: 256, quality: 80, error: 0.01 },
  low: { texBig: 256, texSmall: 128, quality: 72, error: 0.05 },
};

const slug = process.argv[2];
const want = process.argv.slice(3).length ? process.argv.slice(3) : ['high', 'low'];
const cfg = CONFIG[slug];
if (!cfg) throw new Error(`unknown circuit "${slug}" (see circuits.json)`);
const SRC = path.join(ROOT, 'scripts', 'circuits', 'source', slug, 'scene.gltf');
const FIT = JSON.parse(fs.readFileSync(path.join(HERE, `${slug}.align.json`), 'utf8'));
const OUT = path.join(ROOT, 'public', 'models', 'circuits', slug);

// ---------------------------------------------------------------- placement

const F = FIT.mirrorX ? -1 : 1;
const [[r00, r01], [r10, r11]] = FIT.R;
const ctrl = FIT.controls; // [x, z, dx, dy, dz] in GhostLap units
const R2 = (FIT.warpRadius / 2) ** 2;

/** model world xz,y -> GhostLap (before warp) */
function similar(x, y, z) {
  const ax = F * (x - FIT.cModel[0]);
  const az = z - FIT.cModel[1];
  return [FIT.scale * (r00 * ax + r01 * az) + FIT.t[0], FIT.ya * y + FIT.yb, FIT.scale * (r10 * ax + r11 * az) + FIT.t[1]];
}

/** Smooth warp: inverse-distance blend of the racing-line residuals (no fade-out, so far terrain stays continuous). */
function warp(x, z) {
  let sw = 0, dx = 0, dy = 0, dz = 0;
  for (const c of ctrl) {
    const d2 = (c[0] - x) ** 2 + (c[1] - z) ** 2;
    const w = 1 / (d2 + R2) ** 2;
    sw += w;
    dx += w * c[2];
    dy += w * c[3];
    dz += w * c[4];
  }
  return [dx / sw, dy / sw, dz / sw];
}

// coarse grid over the racing line for "is this triangle on the track?" queries
const CELL = 4;
const grid = new Map();
for (let i = 0; i < ctrl.length; i++) {
  const key = `${Math.floor(ctrl[i][0] / CELL)},${Math.floor(ctrl[i][1] / CELL)}`;
  (grid.get(key) ?? grid.set(key, []).get(key)).push(i);
}
// racing-line height at each control (y of GhostLap's line = model road after warp)
const lineY = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', '2026', 'races', `${slug}.json`), 'utf8'));
const linePts = (lineY.circuit ?? lineY.geometry).points;
function nearestLine(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = Infinity, bi = -1;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const i of grid.get(`${cx + a},${cz + b}`) ?? []) {
        const d = (ctrl[i][0] - x) ** 2 + (ctrl[i][1] - z) ** 2;
        if (d < best) (best = d), (bi = i);
      }
  return bi < 0 ? null : { d: Math.sqrt(best), i: bi };
}
// height of the racing line near a control point: nearest original circuit point
function lineHeightAt(x, z) {
  let best = Infinity, y = 0;
  for (const p of linePts) {
    const d = (p[0] - x) ** 2 + (p[2] - z) ** 2;
    if (d < best) (best = d), (y = p[1]);
  }
  return y;
}
const ctrlY = ctrl.map((c) => lineHeightAt(c[0], c[1]));

// ---------------------------------------------------------------- build

/** Keep an evenly spread subset of whole islands; false when the piece isn't island-heavy. */
function thinIslands(p, target) {
  const pos = p.getAttribute('POSITION').getArray();
  const idx = p.getIndices().getArray();
  const isl = triangleIslands(pos, idx);
  const count = isl.count;
  const tris = idx.length / 3;
  if (count < 60 || tris / count > 400) return false;
  const keepEvery = tris / target;
  const out = [];
  for (let t = 0; t < tris; t++) {
    const k = isl.tri[t];
    if (Math.floor(k / keepEvery) !== Math.floor((k + 1) / keepEvery) || keepEvery <= 1) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  }
  p.getIndices().setArray(pos.length / 3 > 65535 ? new Uint32Array(out) : new Uint16Array(out));
  compactPrimitive(p);
  return true;
}

function matName(p) {
  return p.getMaterial()?.getName() ?? '';
}

async function build(lod) {
  const recipe = LODS[lod];
  const io = await makeIO();
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const drop = [...cfg.drop, ...(lod === 'low' ? cfg.dropLow : [])].map((s) => new RegExp(s));

  const meshNodes = [];
  scene.traverse((n) => n.getMesh() && meshNodes.push(n));
  const buffer = root.listBuffers()[0];
  const out = doc.createMesh(slug);
  let cut = 0;

  for (const node of meshNodes) {
    const m = node.getWorldMatrix();
    // normal matrix = inverse transpose of the upper 3x3 (cofactors; scale is irrelevant after normalising)
    const n3 = [
      m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8],
      m[2] * m[9] - m[1] * m[10], m[0] * m[10] - m[2] * m[8], m[1] * m[8] - m[0] * m[9],
      m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4],
    ];
    const flip = m[0] * n3[0] + m[1] * n3[1] + m[2] * n3[2] < 0 !== (F < 0); // winding flips with det < 0
    for (const prim of node.getMesh().listPrimitives()) {
      const name = matName(prim);
      if (drop.some((re) => re.test(name))) continue;
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const count = pos.getCount();
      const P = new Float32Array(count * 3);
      const N = nor ? new Float32Array(count * 3) : null;
      const v = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        pos.getElement(i, v);
        const wx = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const wy = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const wz = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        const [x, y, z] = similar(wx, wy, wz);
        const [dx, dy, dz] = warp(x, z);
        P[i * 3] = x + dx;
        P[i * 3 + 1] = y + dy - SINK;
        P[i * 3 + 2] = z + dz;
        if (N) {
          nor.getElement(i, v);
          let nx = n3[0] * v[0] + n3[1] * v[1] + n3[2] * v[2];
          const ny = n3[3] * v[0] + n3[4] * v[1] + n3[5] * v[2];
          let nz = n3[6] * v[0] + n3[7] * v[1] + n3[8] * v[2];
          nx *= F;
          const rx = r00 * nx + r01 * nz, rz = r10 * nx + r11 * nz;
          const l = Math.hypot(rx, ny, rz) || 1;
          N[i * 3] = rx / l;
          N[i * 3 + 1] = ny / l;
          N[i * 3 + 2] = rz / l;
        }
      }
      // triangles: drop what would stand on GhostLap's asphalt/kerbs, fix winding
      const idx = prim.getIndices();
      const nIdx = idx ? idx.getCount() : count;
      const I = [];
      for (let t = 0; t + 2 < nIdx; t += 3) {
        const a = idx ? idx.getScalar(t) : t, b = idx ? idx.getScalar(t + 1) : t + 1, c = idx ? idx.getScalar(t + 2) : t + 2;
        const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
        const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
        const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        const near = nearestLine(cx, cz);
        if (near && near.d < CLEAR_HALF) {
          const h = cy - ctrlY[near.i];
          if (h > CLEAR_MIN_H && h < CLEAR_MAX_H) {
            cut++;
            continue;
          }
        }
        if (flip) I.push(a, c, b);
        else I.push(a, b, c);
      }
      if (!I.length) continue;
      const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
      np.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer));
      if (N) np.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer));
      for (const sem of prim.listSemantics()) {
        if (sem === 'POSITION' || sem === 'NORMAL' || sem === 'TANGENT' || /^TEXCOORD_[1-9]/.test(sem)) continue;
        np.setAttribute(sem, prim.getAttribute(sem));
      }
      const big = count > 65535;
      np.setIndices(doc.createAccessor().setType('SCALAR').setArray(big ? new Uint32Array(I) : new Uint16Array(I)).setBuffer(buffer));
      out.addPrimitive(np);
    }
  }

  // replace the scene with one flat node
  for (const c of scene.listChildren()) scene.removeChild(c);
  for (const n of root.listNodes()) n.dispose();
  scene.addChild(doc.createNode(slug).setMesh(out));
  for (const mesh of root.listMeshes()) if (mesh !== out) mesh.dispose();
  await doc.transform(prune(), dedup(), join({ keepNamed: false }), weld());

  let tris0 = 0, tris1 = 0;
  for (const p of out.listPrimitives()) {
    const n0 = p.getIndices().getCount() / 3;
    tris0 += n0;
    const keep = cfg.keep[lod];
    if (keep < 1 && n0 > 200) {
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: keep, error: recipe.error, lockBorder: false });
      compactPrimitive(p);
      // many-small-islands pieces (tree/grass clumps, crowds of props) stall the
      // topology-preserving simplifier: fall back to the sloppy one for big leftovers
      const target = Math.round(n0 * keep);
      if (p.getIndices().getCount() / 3 > target * 1.5 && (lod === 'low' || n0 > 20000)) {
        // many separate pieces (trees, props): keep whole pieces, fewer of them, instead of
        // the sloppy simplifier, which melts foliage into shards
        if (!thinIslands(p, target)) sloppy(p, target);
      }
    }
    tris1 += p.getIndices().getCount() / 3;
  }

  // textures -> small WebP (512/256 px in high, 128/64 px in low)
  for (const tex of root.listTextures()) {
    const img = sharp(Buffer.from(tex.getImage()));
    const meta = await img.metadata();
    const w = meta.width ?? 256, h = meta.height ?? 256;
    const max = Math.max(w, h) >= 1024 ? recipe.texBig : recipe.texSmall;
    const k = Math.min(1, max / Math.max(w, h));
    const buf = await img
      .resize(Math.max(4, Math.round(w * k)), Math.max(4, Math.round(h * k)), { fit: 'fill' })
      .webp({ quality: recipe.quality, alphaQuality: 85, effort: 6 })
      .toBuffer();
    tex.setImage(new Uint8Array(buf)).setMimeType('image/webp').setURI('');
  }
  for (const mat of root.listMaterials()) {
    // the source's metallic/roughness/normal maps are not worth their bytes at our distances
    mat.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    mat.setMetallicFactor(0).setRoughnessFactor(0.9);
  }
  await doc.transform(
    prune({ keepAttributes: false }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 8, quantizeTexcoord: 12 }),
  );
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${slug}-${lod}.glb`);
  await io.write(file, doc);
  console.log(
    `${slug}-${lod}.glb  ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB  tris ${Math.round(tris0)} -> ${Math.round(tris1)}  ` +
      `primitives ${out.listPrimitives().length}  textures ${root.listTextures().length}  cut-on-track ${cut}`,
  );
}

for (const lod of want) await build(lod);
