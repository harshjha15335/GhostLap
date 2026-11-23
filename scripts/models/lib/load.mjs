// Load the original W17 GLB into a flat, world-space gltf-transform Document:
// one scene, one node per mesh, identity transforms, car conventions applied
// (forward +Z, up +Y, origin at the floor centre on the ground, metres).
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export async function makeIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

export async function loadW17(file) {
  const io = await makeIO();
  const doc = await io.read(file);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const meshNodes = [];
  scene.traverse((n) => n.getMesh() && meshNodes.push(n));
  // bake world matrices into the vertex data
  const done = new Set();
  for (const n of meshNodes) {
    const m = n.getWorldMatrix();
    for (const p of n.getMesh().listPrimitives()) {
      if (done.has(p)) continue;
      done.add(p);
      transformPrimitive(p, m);
    }
  }
  // rebuild a flat hierarchy
  const flat = meshNodes.map((n) => doc.createNode(n.getMesh().getName() || n.getName()).setMesh(n.getMesh()));
  for (const c of scene.listChildren()) scene.removeChild(c);
  for (const n of flat) scene.addChild(n);
  for (const n of root.listNodes()) if (!flat.includes(n)) n.dispose();
  // ground the tyres at y = 0 and centre the car's length on the wheelbase midpoint? keep z as authored
  const b = getBounds(scene);
  const dy = -b.min[1];
  const dx = -(b.min[0] + b.max[0]) / 2;
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, 0, 1];
  for (const p of done) transformPrimitive(p, T);
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      // TEXCOORD_1 (lightmap set) and tangents are unused by three's standard material here
      for (const s of ['TEXCOORD_1', 'TANGENT']) {
        const a = p.getAttribute(s);
        if (a) p.setAttribute(s, null);
      }
    }
  }
  await doc.transform(prune());
  return { io, doc };
}

/** Material base name without Blender's ".007" suffix. */
export const matName = (m) => (m?.getName() ?? '').replace(/\.\d+$/, '');
