import { describe, it, expect } from 'vitest';
import { carStats } from './carGeometry';

describe('car geometry stats', () => {
  it('low detail budget', () => {
    const s = carStats('low');
    console.log('Low detail car:', s);
    expect(s.tris).toBeLessThanOrEqual(4000);
    expect(s.meshes).toBeLessThanOrEqual(16 * 2); // mesh entries in geo
  });

  it('high detail budget', () => {
    const s = carStats('high');
    console.log('High detail car:', s);
    expect(s.tris).toBeLessThanOrEqual(40000);
    expect(s.meshes).toBeLessThanOrEqual(30 * 2);
  });
});
