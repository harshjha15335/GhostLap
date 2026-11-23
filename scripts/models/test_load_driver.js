import fs from 'fs';
globalThis.self = globalThis;
if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close: () => {} });
}
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const buffer = fs.readFileSync('public/models/driver.glb');
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuffer, '', (gltf) => {
  console.log('Driver GLB parsed successfully!');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  console.log('Bounding Box Min:', box.min);
  console.log('Bounding Box Max:', box.max);
  console.log('Bounding Box Size (X, Y, Z):', size);
  console.log('Bounding Box Center:', center);

  let totalTris = 0;
  console.log('\n--- Meshes in Scene ---');
  scene.traverse((child) => {
    if (child.isMesh) {
      const geo = child.geometry;
      let tris = 0;
      if (geo.index) tris = geo.index.count / 3;
      else if (geo.attributes.position) tris = geo.attributes.position.count / 3;
      totalTris += tris;
      const mbox = new THREE.Box3().setFromObject(child);
      console.log(`Mesh: '${child.name}', parent: '${child.parent?.name}', mat: '${child.material?.name}', tris: ${tris}, Y: [${mbox.min.y.toFixed(2)}, ${mbox.max.y.toFixed(2)}], Z: [${mbox.min.z.toFixed(2)}, ${mbox.max.z.toFixed(2)}], X: [${mbox.min.x.toFixed(2)}, ${mbox.max.x.toFixed(2)}]`);
    }
  });
  console.log(`\nTotal Triangles: ${totalTris}`);
});
