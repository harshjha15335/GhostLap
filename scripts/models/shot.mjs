// Dev helper: screenshot a URL with headless Chromium (SwiftShader WebGL).
// Usage: node scripts/models/shot.mjs <url> <out.png> [width] [height] [waitMs]
// Waits for window.__ready (viewer) or waitMs. Logs console errors + bytes downloaded per type.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const [, , url, out, w = '1280', h = '800', wait = '0'] = process.argv;
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const bytes = {};
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', async (r) => {
  const u = r.url();
  if (!/\.(glb|webp|png|jpg)(\?|$)/.test(u)) return;
  try {
    const b = await r.body();
    const k = u.replace(/^https?:\/\/[^/]+/, '');
    bytes[k] = b.length;
  } catch {}
});
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
if (Number(wait) > 0) await page.waitForTimeout(Number(wait));
else await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.screenshot({ path: out });
const glb = Object.entries(bytes).filter(([k]) => k.includes('.glb'));
console.log('GLB bytes', JSON.stringify(glb), 'total', glb.reduce((a, [, v]) => a + v, 0));
console.log('image bytes', Object.entries(bytes).filter(([k]) => !k.includes('.glb')).reduce((a, [, v]) => a + v, 0));
await browser.close();
