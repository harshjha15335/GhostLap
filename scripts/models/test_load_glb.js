import fs from 'fs';
globalThis.self = globalThis;
if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close: () => {} });
}
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const buffer = fs.readFileSync('public/models/w17.glb');
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuffer, '', (gltf) => {
  console.log('Successfully parsed GLTF scene!');
  const scene = gltf.scene;
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  console.log('Bounding Box Min:', box.min);
  console.log('Bounding Box Max:', box.max);
  console.log('Bounding Box Size (X, Y, Z):', size);
  console.log('Bounding Box Center:', center);

  let meshCount = 0;
  let triCount = 0;
  scene.traverse((child) => {
    if (child.isMesh) {
      meshCount++;
      const geo = child.geometry;
      if (geo.index) {
        triCount += geo.index.count / 3;
      } else if (geo.attributes.position) {
        triCount += geo.attributes.position.count / 3;
      }
    }
  });
  console.log('Total meshes in scene:', meshCount);
  console.log('Total triangles in scene:', triCount);
}, (err) => {
  console.error('Failed to parse:', err);
});
