// Export every world-space vertex of the materials whose name matches a regex (the model's
// asphalt), for scripts/circuits/sketchfab/align.py.
// usage: node export-road.mjs <scene.gltf|glb> <materialRegex> <out.json> [step]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';

const [src, pattern, out, stepArg] = process.argv.slice(2);
const step = Number(stepArg ?? 0.02); // model units between samples along each edge
const raw = [];
const re = new RegExp(pattern);
const doc = await new NodeIO().read(src);
const pts = [];
const v = [0, 0, 0];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    if (!re.test(p.getMaterial()?.getName() ?? '')) continue;
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const w = (i) => {
      pos.getElement(i, v);
      return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
      ];
    };
    for (let t = 0; t + 2 < n; t += 3) {
      const tri = [0, 1, 2].map((k) => w(idx ? idx.getScalar(t + k) : t + k));
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const steps = Math.max(1, Math.ceil(len / step));
        for (let k = 0; k < steps; k++) {
          const f = k / steps;
          raw.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
        }
      }
    }
  }
}
// thin to one point per (step/2)-sized cell
const seen = new Set();
for (const q of raw) {
  const key = `${Math.round(q[0] / (step / 2))},${Math.round(q[2] / (step / 2))}`;
  if (seen.has(key)) continue;
  seen.add(key);
  pts.push(q.map((x) => +x.toFixed(5)));
}
fs.writeFileSync(out, JSON.stringify(pts));
console.log(`${pts.length} road vertices -> ${out}`);
