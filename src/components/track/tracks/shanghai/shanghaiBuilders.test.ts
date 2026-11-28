import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundle } from '@/engine/testUtils';
import { createCircuitCurve } from '@/engine/circuitCurve';
import { buildTrackModel } from '../../trackModel';
import { buildAsphalt, buildBarriers, buildKerbs, buildLayout, buildLines, buildVerges } from '../../geometry';
import type { CircuitEnvData } from '../shared/types';
import {
  buildShanghaiAdsGeometry,
  buildShanghaiBuildings,
  buildShanghaiOverlays,
  buildShanghaiStructures,
  buildShanghaiTerrain,
  buildShanghaiTreeInstances,
  buildShanghaiWater,
  shanghaiTreeGeometry,
} from './shanghaiBuilders';

function readEnv(file: string): CircuitEnvData {
  const p = path.resolve(process.cwd(), 'public/models/circuits/shanghai', file);
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as CircuitEnvData;
}

function triCount(g: { getAttribute(name: string): { count: number }; index: { count: number } | null }): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}

describe('Shanghai International Circuit (2026 Chinese GP) environment', () => {
  it('stays well within hard asset download budgets (<=3 MB high, <=600 KB low)', () => {
    const dir = path.resolve(process.cwd(), 'public/models/circuits/shanghai');
    const highBytes =
      fs.statSync(path.join(dir, 'shanghai_env.json')).size +
      fs.statSync(path.join(dir, 'ads.webp')).size +
      fs.statSync(path.join(dir, 'facades.webp')).size;
    const lowBytes =
      fs.statSync(path.join(dir, 'shanghai_env_low.json')).size +
      fs.statSync(path.join(dir, 'ads_low.webp')).size +
      fs.statSync(path.join(dir, 'facades_low.webp')).size;
    expect(highBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(lowBytes).toBeLessThanOrEqual(600 * 1024);
  });

  it.each(['high', 'low'] as const)('builds %s quality within triangle and draw-call budgets', (quality) => {
    const env = readEnv(quality === 'low' ? 'shanghai_env_low.json' : 'shanghai_env.json');
    const c = loadBundle('shanghai').circuit;
    const cc = createCircuitCurve(c);
    const m = buildTrackModel(c, cc, {
      quality,
      trackWidth: quality === 'low' ? 3.4 : 3.0,
      minHalfWidth: quality === 'low' ? 1.5 : 1.0,
      pitLane: quality === 'low' ? { offset: 3.05, width: 1.3 } : null,
      pitSpan: 0.075,
    });
    const lay = buildLayout(m, quality);
    const terrain = buildShanghaiTerrain(m, lay, env, quality);
    const water = buildShanghaiWater(m, env, quality);
    const overlays = buildShanghaiOverlays(m, env);
    const asphalt = buildAsphalt(m, lay);
    const verges = buildVerges(m, lay, 1);
    const kerbs = buildKerbs(m, lay);
    const lines = buildLines(m, lay, c.sectorSplits);
    const barriers = buildBarriers(m, lay, terrain);
    const structures = buildShanghaiStructures(m, lay, env, quality);
    const buildings = buildShanghaiBuildings(m, terrain, env, quality);
    const ads = buildShanghaiAdsGeometry(m, lay, env);
    const trees = buildShanghaiTreeInstances(m, terrain, env);

    for (let i = 0; i < m.n; i += 9) {
      expect(terrain.heightAt(m.px[i], m.pz[i])).toBeLessThan(m.py[i] + 0.02);
    }

    const treeGeo = shanghaiTreeGeometry();
    const staticGeos = [
      terrain.geometry,
      water,
      overlays,
      asphalt,
      verges,
      kerbs,
      lines,
      barriers,
      structures.geometry,
      buildings.facades,
      buildings.roofs,
      ads,
    ];
    let totalTris = 0;
    for (const g of staticGeos) {
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      totalTris += triCount(g);
      g.dispose();
    }
    totalTris += triCount(treeGeo) * trees.matrices.length;
    totalTris += 12 * structures.lights.length;
    treeGeo.dispose();

    // 12 static meshes + 2 instanced meshes (trees, lights) = 14 draw calls
    const drawCalls = staticGeos.length + 2;
    console.log(
      `Shanghai [${quality}]: tris=${Math.round(totalTris)}, drawCalls=${drawCalls}, buildings=${env.buildings.length}, trees=${trees.matrices.length}`,
    );

    if (quality === 'low') {
      expect(drawCalls).toBeLessThanOrEqual(150);
      expect(totalTris).toBeLessThanOrEqual(250_000);
    } else {
      expect(drawCalls).toBeLessThanOrEqual(400);
      expect(totalTris).toBeLessThanOrEqual(800_000);
    }
  });
});
