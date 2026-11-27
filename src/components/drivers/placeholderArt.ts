/**
 * Reveal-layer stand-in for drivers whose helmet image has not been supplied. It is a
 * plainly labelled graphic panel (team colour, number, "helmet image not supplied"), not
 * a drawing of a helmet: GhostLap never invents a driver's helmet design.
 */

const cache = new Map<string, HTMLCanvasElement>();

export const PLACEHOLDER_W = 640;
export const PLACEHOLDER_H = 800;

export async function placeholderReveal(code: string, number: number, color: string): Promise<HTMLCanvasElement> {
  const key = `${code}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    await document.fonts.load('120px "Anton"');
    await document.fonts.load('600 20px "JetBrains Mono"');
  } catch {
    /* fall back to Impact / monospace */
  }
  const c = document.createElement('canvas');
  c.width = PLACEHOLDER_W;
  c.height = PLACEHOLDER_H;
  const g = c.getContext('2d')!;
  const W = PLACEHOLDER_W;
  const H = PLACEHOLDER_H;

  // ink sheet + team-colour diagonal bands
  g.fillStyle = '#170F33';
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.42);
  for (let i = -6; i <= 6; i++) {
    g.fillStyle = i % 2 ? color : '#FF2E88';
    g.globalAlpha = i % 2 ? 0.95 : 0.22;
    g.fillRect(i * 120 - 30, -H, 46, H * 2);
  }
  g.restore();
  g.globalAlpha = 1;

  // halftone screen
  g.fillStyle = 'rgba(255,247,238,0.10)';
  for (let y = 7; y < H; y += 14) for (let x = 7 + ((y / 14) % 2) * 7; x < W; x += 14) {
    g.beginPath();
    g.arc(x, y, 1.6, 0, Math.PI * 2);
    g.fill();
  }

  // giant number, chalk with an ink drop
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '360px "Anton", Impact, sans-serif';
  g.fillStyle = '#170F33';
  g.fillText(String(number), W / 2 + 14, H * 0.6 + 16);
  g.fillStyle = '#FFF7EE';
  g.fillText(String(number), W / 2, H * 0.6);

  // label sticker
  const label = 'HELMET IMAGE NOT SUPPLIED';
  g.font = '600 22px "JetBrains Mono", ui-monospace, monospace';
  const tw = g.measureText(label).width + 36;
  g.save();
  g.translate(W / 2, H * 0.74);
  g.rotate(-0.035);
  g.fillStyle = '#170F33';
  g.fillRect(-tw / 2 + 5, -24 + 6, tw, 48);
  g.fillStyle = '#FFD23F';
  g.fillRect(-tw / 2, -24, tw, 48);
  g.strokeStyle = '#170F33';
  g.lineWidth = 3;
  g.strokeRect(-tw / 2, -24, tw, 48);
  g.fillStyle = '#170F33';
  g.textBaseline = 'middle';
  g.fillText(label, 0, 1);
  g.restore();

  g.font = '600 26px "JetBrains Mono", ui-monospace, monospace';
  g.fillStyle = '#FFF7EE';
  g.textBaseline = 'middle';
  g.fillText(code, W / 2, H * 0.84);

  cache.set(key, c);
  return c;
}
