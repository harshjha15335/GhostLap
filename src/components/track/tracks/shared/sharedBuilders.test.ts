import { describe, expect, it } from 'vitest';
import { buildWaterGeometry, createDaytimeWaterMaterial, distToPolys, smoothClosedPoly } from './water';
import { circuitAdsUrl, circuitAssetUrl, circuitFacadesUrl } from './loader';

describe('shared circuit track builders', () => {
  it('builds BASE_URL-prefixed asset URLs for any circuit slug', () => {
    expect(circuitAssetUrl('shanghai', 'shanghai_env.json')).toContain('models/circuits/shanghai/shanghai_env.json');
    expect(circuitAdsUrl('melbourne', 'low')).toContain('models/circuits/melbourne/ads_low.webp');
    expect(circuitFacadesUrl('shanghai', 'high')).toContain('models/circuits/shanghai/facades.webp');
  });

  it('smooths closed water polygons and bakes shore distance into vertex colors', () => {
    const square: [number, number][] = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ];
    const smoothed = smoothClosedPoly(square, 2);
    expect(smoothed.length).toBe(square.length * 4);
    expect(distToPolys(0, 0, [square])).toBeCloseTo(10, 2);

    const geo = buildWaterGeometry([square], [], [], 0, 'high', 10);
    expect(geo.getAttribute('position').count).toBeGreaterThan(12);
    expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count);
    geo.dispose();

    const mat = createDaytimeWaterMaterial();
    expect(mat.uniforms.uTime.value).toBe(0);
    mat.dispose();
  });
});
