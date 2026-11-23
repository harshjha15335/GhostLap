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
export function trackTextTexture(text: string, color = '#FFD23F') {
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

/* ----------------------------- halftone + road ----------------------------- */

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

let dotsCache: THREE.CanvasTexture | null = null;
let dotsUsers = 0;

/**
 * Halftone dot screen (the "Pit-Lane Pop" surface motif): a light greyscale tile, white
 * paper with soft round dots on a 45-degree grid, meant to be multiplied over a flat
 * colour. Mipmapped so the dots melt into an even tint at grazing angles instead of
 * shimmering. Tiles seamlessly; shared (ref-counted) between the ground planes.
 */
export function acquireHalftoneTexture(): THREE.CanvasTexture {
  dotsUsers++;
  if (dotsCache) return dotsCache;
  const size = 256;
  const cell = 16;
  const [c, g] = canvas(size, size);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  // value ~0.87 in linear space -> a dot ~6% darker than the sheet once multiplied
  g.fillStyle = 'rgb(222,222,222)';
  for (let y = 0; y <= size; y += cell / 2) {
    const odd = (y / (cell / 2)) % 2 === 1;
    for (let x = odd ? cell / 2 : 0; x <= size; x += cell) {
      g.beginPath();
      g.arc(x, y, cell * 0.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  dotsCache = t;
  return t;
}

export function releaseHalftoneTexture() {
  dotsUsers = Math.max(0, dotsUsers - 1);
  if (!dotsUsers && dotsCache) {
    dotsCache.dispose();
    dotsCache = null;
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
