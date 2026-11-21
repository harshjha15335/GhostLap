import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D] as const;
}

/** Wet asphalt: fine aggregate grain + darker damp patches (used as map + roughnessMap). */
export function asphaltTextures(size = 512) {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  // value noise for puddles
  const grid = 8;
  const rnd: number[] = [];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (grid + 1) * (grid + 1); i++) rnd.push(r());
  const at = (x: number, y: number) => rnd[(y % grid) * (grid + 1) + (x % grid)];
  const noise = (u: number, v: number) => {
    const x = u * grid;
    const y = v * grid;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = r();
      const puddle = noise(x / size, y / size);
      // rough channel: wet patches are smooth (dark)
      const rough = Math.min(255, Math.max(0, (0.55 + (puddle - 0.5) * 0.5) * 255 + (grain - 0.5) * 46));
      img.data[i] = rough;
      img.data[i + 1] = rough;
      img.data[i + 2] = rough;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const rough = new THREE.CanvasTexture(c);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.colorSpace = THREE.NoColorSpace;

  const [c2, g2] = canvas(size, size);
  const img2 = g2.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = 12 + r() * 18 + (noise(x / size, y / size) - 0.5) * 10;
      img2.data[i] = v * 0.92;
      img2.data[i + 1] = v * 0.97;
      img2.data[i + 2] = v * 1.1;
      img2.data[i + 3] = 255;
    }
  }
  g2.putImageData(img2, 0, 0);
  const map = new THREE.CanvasTexture(c2);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, rough };
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
