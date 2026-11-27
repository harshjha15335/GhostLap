/**
 * Reveal-layer panel for drivers whose 2026 helmet image is not available yet: a designed
 * team-colour halftone panel with the number and "2026 HELMET · COMING SOON". It is not a
 * drawing of a helmet: GhostLap never invents a driver's helmet design.
 */

const cache = new Map<string, HTMLCanvasElement>();

export const PLACEHOLDER_W = 640;
export const PLACEHOLDER_H = 800;
/** head centre height in the frame (see scripts/drivers/process_driver_media.py) */
const HEAD_CY = 0.24;

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

  // everything is laid out around the head (the reveal only opens over the face):
  // head centre at (0.5, HEAD_CY) of the frame, matching the portrait pipeline's framing
  const cx = W / 2;
  const cy = H * HEAD_CY;

  // number, chalk with an ink drop
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '150px "Anton", Impact, sans-serif';
  g.fillStyle = '#170F33';
  g.fillText(String(number), cx + 8, cy + 38 + 9);
  g.fillStyle = '#FFF7EE';
  g.fillText(String(number), cx, cy + 38);

  // two-line label sticker under the number
  g.font = '700 19px "JetBrains Mono", ui-monospace, monospace';
  const lines = ['2026 HELMET', 'COMING SOON'];
  const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 28;
  const th = 58;
  g.save();
  g.translate(cx, cy + 92);
  g.rotate(-0.04);
  g.fillStyle = '#170F33';
  g.fillRect(-tw / 2 + 4, -th / 2 + 5, tw, th);
  g.fillStyle = '#FFD23F';
  g.fillRect(-tw / 2, -th / 2, tw, th);
  g.strokeStyle = '#170F33';
  g.lineWidth = 3;
  g.strokeRect(-tw / 2, -th / 2, tw, th);
  g.fillStyle = '#170F33';
  g.textBaseline = 'middle';
  g.fillText(lines[0], 0, -12);
  g.fillText(lines[1], 0, 13);
  g.restore();

  g.font = '600 20px "JetBrains Mono", ui-monospace, monospace';
  g.fillStyle = '#FFF7EE';
  g.fillText(code, cx, cy - 92);

  cache.set(key, c);
  return c;
}
