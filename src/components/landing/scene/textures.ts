import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D] as const;
}

/** Soft radial blob for contact shadows / glows. */
export function radialTexture(inner = 'rgba(0,0,0,0.85)', outer = 'rgba(0,0,0,0)') {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Greyscale alpha map (alphaMap reads the green channel): bright at v=0 -> black at v=1, soft sides. */
export function wakeTexture() {
  const [c, g] = canvas(32, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 32, 128);
  for (let x = 0; x < 32; x++) {
    const side = Math.sin((Math.PI * (x + 0.5)) / 32);
    const grad = g.createLinearGradient(0, 128, 0, 0);
    const v = Math.round(255 * side * side);
    grad.addColorStop(0, `rgb(${v},${v},${v})`);
    grad.addColorStop(0.3, `rgb(${Math.round(v * 0.45)},${Math.round(v * 0.45)},${Math.round(v * 0.45)})`);
    grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.fillRect(x, 0, 1, 128);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Repeating trackside lettering strip. Redraws once the display font has loaded. */
export function trackTextTexture(text: string, color = '#D4FF00') {
  const [c, g] = canvas(2048, 160);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const draw = () => {
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = color;
    g.font = '120px Anton, Impact, sans-serif';
    g.textBaseline = 'middle';
    const w = g.measureText(text).width;
    const sx = c.width / w;
    g.save();
    g.scale(sx, 1);
    g.fillText(text, 0, c.height / 2 + 6);
    g.restore();
    t.needsUpdate = true;
  };
  draw();
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.load('120px Anton').then(draw).catch(() => {});
  }
  return t;
}

/* ------------------------------ paper + road ------------------------------ */

/** Periodic value noise on a `grid`-cell lattice (tiles seamlessly over 0..1). */
function periodicNoise(grid: number, seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const lat = new Float32Array(grid * grid);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  return (u: number, v: number) => {
    const x = u * grid;
    const y = v * grid;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % grid) + grid) % grid;
    const y0 = ((yi % grid) + grid) % grid;
    const x1 = (x0 + 1) % grid;
    const y1 = (y0 + 1) % grid;
    const a = lat[y0 * grid + x0] + (lat[y0 * grid + x1] - lat[y0 * grid + x0]) * sx;
    const b = lat[y1 * grid + x0] + (lat[y1 * grid + x1] - lat[y1 * grid + x0]) * sx;
    return a + (b - a) * sy;
  };
}

let paperCache: THREE.CanvasTexture | null = null;
let paperUsers = 0;

/**
 * Crumpled-paper relief: faceted folds lit from the upper left, written as a light greyscale (~0.75..1) meant to be multiplied over a flat colour.
 * Tiles seamlessly; shared (ref-counted) between the backdrop and the ground planes.
 */
export function acquirePaperTexture(): THREE.CanvasTexture {
  paperUsers++;
  if (paperCache) return paperCache;
  const size = 512;
  // Crumpled paper = flat facets between straight creases. Each fold is a tiling
  // triangle wave across the sheet (integer wave vector), so the slope is piecewise
  // constant and every crease is a sharp straight line; a gentle warp bends them a bit.
  let seed = 23;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const folds: { kx: number; ky: number; ph: number; a: number }[] = [];
  while (folds.length < 22) {
    const kx = Math.round((r() - 0.5) * 9);
    const ky = Math.round((r() - 0.5) * 9);
    const k = Math.hypot(kx, ky);
    if (k < 1) continue;
    folds.push({ kx, ky, ph: r(), a: 0.9 / Math.pow(k, 1.2) });
  }
  const warp = periodicNoise(3, 7);
  const warp2 = periodicNoise(3, 11);
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const lx = -0.55;
  const ly = -0.5;
  const lz = 0.67;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u0 = x / size;
      const v0 = y / size;
      const u = u0 + (warp(u0, v0) - 0.5) * 0.16;
      const v = v0 + (warp2(u0, v0) - 0.5) * 0.16;
      // analytic slope of the summed folds
      let dx = 0;
      let dy = 0;
      for (const f of folds) {
        const t = f.kx * u + f.ky * v + f.ph;
        const s = t - Math.floor(t) < 0.5 ? -1 : 1;
        dx += f.a * f.kx * s;
        dy += f.a * f.ky * s;
      }
      dx *= 0.09;
      dy *= 0.09;
      const nl = Math.hypot(dx, dy, 1);
      const lam = (-dx * lx - dy * ly + lz) / nl;
      const vv = Math.min(1, Math.max(0, 0.94 + (lam - lz) * 0.32 + (r() - 0.5) * 0.03));
      const i = (y * size + x) * 4;
      const b = Math.round(vv * 255);
      img.data[i] = b;
      img.data[i + 1] = b;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  paperCache = t;
  return t;
}

export function releasePaperTexture() {
  paperUsers = Math.max(0, paperUsers - 1);
  if (!paperUsers && paperCache) {
    paperCache.dispose();
    paperCache = null;
  }
}

/**
 * Dry-asphalt aggregate for the road ribbons: dark grey with fine stone speckle and
 * soft patching. Mipmapped + anisotropic so it stays calm at grazing angles.
 */
export function roadAsphaltTexture(size = 256) {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const patch = periodicNoise(4, 41);
  let seed = 31;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = r();
      const stone = grain > 0.94 ? 22 : grain < 0.05 ? -12 : 0;
      const v = 200 + (grain - 0.5) * 30 + stone + (patch(x / size, y / size) - 0.5) * 26;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
