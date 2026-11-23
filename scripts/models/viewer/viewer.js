// Dev-only GLB inspection viewer for the W17 pipeline (see index.html for query params).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const file = q.get('file') ?? '/public/models/w17-high.glb';
const views = (q.get('views') ?? '34,side,top,front').split(',');
const partsMode = q.get('parts') === '1';
const explode = Number(q.get('explode') ?? 0);
const paint = q.get('paint');

const PART_COLORS = { frontWing: '#ff3b30', monocoque: '#d0d0d0', floor: '#333333', sidepodL: '#34c759', sidepodR: '#30b0c7', gearbox: '#ff9500', rearWing: '#af52de' };
const EXPLODE = { frontWing: [0, 0.7, 2.1], monocoque: [0, 0, 0], floor: [0, -1.25, 0], sidepodL: [-1.45, 0.1, 0], sidepodR: [1.45, 0.1, 0], gearbox: [0, 0.1, -2.0], rearWing: [0, 1.4, -2.5] };

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('bg') ?? '#b7a3ff');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight('#ffffff', '#8f7ad9', 0.8));
const sun = new THREE.DirectionalLight('#fffaf0', 1.6);
sun.position.set(-6, 8, 10);
scene.add(sun);
if (q.get('grid') !== '0') scene.add(new THREE.GridHelper(8, 16, '#444', '#888'));

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const t0 = performance.now();
const gltf = await loader.loadAsync(file);
const root = gltf.scene;
scene.add(root);
let tris = 0;
let draws = 0;
root.traverse((o) => {
  if (!o.isMesh) return;
  draws++;
  tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
});
root.children.forEach((n) => {
  const v = EXPLODE[n.name];
  if (v && explode) n.position.set(v[0] * explode, v[1] * explode, v[2] * explode);
  if (partsMode && PART_COLORS[n.name]) {
    const m = new THREE.MeshStandardMaterial({ color: PART_COLORS[n.name], roughness: 0.6 });
    n.traverse((o) => o.isMesh && (o.material = m));
  }
});
if (paint) {
  const load = async (u) => {
    const t = await new THREE.TextureLoader().loadAsync(u);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const tex = await load(paint);
  const tex2 = q.get('paint2') ? await load(q.get('paint2')) : null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name.replace(/\.\d+$/, '');
    const swap = (t) => {
      const old = o.material.map;
      o.material = o.material.clone();
      const c = t.clone(); // keep the quantisation texture transform (KHR_texture_transform)
      c.offset.copy(old.offset);
      c.repeat.copy(old.repeat);
      c.rotation = old.rotation;
      c.center.copy(old.center);
      o.material.map = c;
    };
    if (n === 'mercedes_paint') {
      swap(tex);
    }
    if (n === 'mercedes_paint2' && tex2) {
      swap(tex2);
    }
    if (n === 'mercedes_decals' || n === 'mercedes_number_63') o.visible = false;
  });
}
const atlas = q.get('atlas');
if (atlas) {
  const tex = await new THREE.TextureLoader().loadAsync(atlas); // flipY = true, like the app
  tex.colorSpace = THREE.SRGBColorSpace;
  const tex1 = tex.clone();
  tex1.channel = 1;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name === 'mercedes_paint' || o.material.name === 'mercedes_paint2') {
      o.material = o.material.clone();
      o.material.map = tex1;
      o.material.metalness = 0.3;
      o.material.needsUpdate = true;
    }
    if (o.material.name === 'mercedes_decals' || o.material.name === 'mercedes_number_63') o.visible = false;
    if (o.material.name === 'w17_low_body') {
      o.material.map = tex;
      o.material.color.set('#ffffff');
      o.material.needsUpdate = true;
    }
  });
}
document.getElementById('info').textContent = `${file}\ntris ${tris} meshes ${draws} load ${(performance.now() - t0).toFixed(0)}ms`;

const box = new THREE.Box3().setFromObject(root);
const c = box.getCenter(new THREE.Vector3());
const D = 7.5 * Number(q.get('zoom') ?? 1);
const VIEW = {
  side: [D, 0.5, 0],
  sideL: [-D, 0.5, 0],
  front: [0, 0.8, D],
  rear: [0, 1.2, -D],
  top: [0, D, 0.001],
  bottom: [0, -D, 0.001],
  34: [D * 0.6, D * 0.35, D * 0.65],
  '34r': [-D * 0.6, D * 0.35, -D * 0.65],
  close: [D * 0.25, D * 0.2, D * 0.3],
};
const cams = views.map((v) => {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const p = VIEW[v] ?? VIEW[34];
  cam.position.set(c.x + p[0], c.y + p[1], c.z + p[2]);
  cam.lookAt(c);
  return cam;
});
const cols = Math.ceil(Math.sqrt(views.length));
const rows = Math.ceil(views.length / cols);
const w = innerWidth / cols;
const h = innerHeight / rows;
cams.forEach((cam, i) => {
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  const x = (i % cols) * w;
  const y = innerHeight - (Math.floor(i / cols) + 1) * h;
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.render(scene, cam);
});
window.__ready = true;
