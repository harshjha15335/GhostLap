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
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  console.log('Scene hierarchy:');
  function printNode(node, depth = 0) {
    console.log(`${' '.repeat(depth * 2)}- ${node.name} (${node.type})`);
    for (const child of node.children) {
      printNode(child, depth + 1);
    }
  }
  printNode(scene);
});
