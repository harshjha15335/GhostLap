import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Reads a GLB's JSON chunk (no decoding needed for counts). */
function glbStats(file: string) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  let tris = 0;
  let prims = 0;
  for (const m of j.meshes)
    for (const p of m.primitives) {
      prims++;
      tris += j.accessors[p.indices].count / 3;
    }
  return { bytes: b.length, tris, prims, materials: j.materials.length, nodes: j.nodes.map((n: { name: string }) => n.name), ext: j.extensionsUsed ?? [] };
}

const dir = path.resolve(__dirname, '../../../public/models');

describe('W17 LOD budgets', () => {
  it('high: ≤3 MB, 60–80k tris, explodable parts, meshopt', () => {
    const s = glbStats(path.join(dir, 'w17-high.glb'));
    expect(s.bytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(s.tris).toBeGreaterThan(60000);
    expect(s.tris).toBeLessThanOrEqual(80000);
    expect(s.nodes).toEqual(expect.arrayContaining(['frontWing', 'monocoque', 'floor', 'sidepodL', 'sidepodR', 'gearbox', 'rearWing']));
    expect(s.ext).toContain('EXT_meshopt_compression');
  });
  it('mid: ≤1.2 MB, ≤20k tris', () => {
    const s = glbStats(path.join(dir, 'w17-mid.glb'));
    expect(s.bytes).toBeLessThanOrEqual(1.2 * 1024 * 1024);
    expect(s.tris).toBeLessThanOrEqual(20000);
  });
  it('low: ≤250 KB, ≤4k tris, 2 primitives / 2 materials (≤3 draw calls per replay car)', () => {
    const s = glbStats(path.join(dir, 'w17-low.glb'));
    expect(s.bytes).toBeLessThanOrEqual(250 * 1024);
    expect(s.tris).toBeLessThanOrEqual(4000);
    expect(s.prims).toBe(2);
    expect(s.materials).toBe(2);
  });
  it('the original 20 MB model is not shipped', () => {
    expect(fs.existsSync(path.join(dir, 'w17.glb'))).toBe(false);
  });
});
