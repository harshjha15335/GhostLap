// Dev helper: draw calls per frame (histogram by index count) + fps + bytes for a page.
// Usage: node scripts/models/measure.mjs <url> [waitMs=12000] [frames=60]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const [, , url, wait = '12000', frames = '60'] = process.argv;
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const bytes = {};
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', async (r) => {
  try {
    const b = await r.body();
    bytes[r.url().replace(/^https?:\/\/[^/]+/, '')] = b.length;
  } catch {}
});
await page.addInitScript(() => {
  const stats = { frames: 0, calls: 0, hist: {} };
  window.__bufIds = 0;
  window.__draws = stats;
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const p = C.prototype;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = p[fn];
      if (!orig) continue;
      p[fn] = function (...a) {
        if (window.__measure) {
          stats.calls++;
          let k = `${fn}:${a[1]}`;
          if (window.__bufIds !== undefined && fn === 'drawElements') {
            const b = this.getParameter(this.ELEMENT_ARRAY_BUFFER_BINDING);
            if (!b.__id) b.__id = ++window.__bufIds;
            k += `#${b.__id}`;
          }
          stats.hist[k] = (stats.hist[k] ?? 0) + 1;
        }
        return orig.apply(this, a);
      };
    }
  }
});
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(Number(wait));
for (const t of (process.env.CLICKS ?? '').split(';').filter(Boolean)) {
  await page.getByText(t, { exact: false }).first().click();
  await page.waitForTimeout(4000);
}
const res = await page.evaluate(
  (n) =>
    new Promise((resolve) => {
      const s = window.__draws;
      let f = 0;
      const t0 = performance.now();
      window.__measure = true;
      const tick = () => {
        f++;
        if (f >= n) {
          window.__measure = false;
          resolve({ frames: f, ms: performance.now() - t0, calls: s.calls, hist: s.hist });
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  Number(frames),
);
const perFrame = Object.entries(res.hist)
  .map(([k, v]) => [k, +(v / res.frames).toFixed(1)])
  .sort((a, b) => b[1] - a[1]);
console.log(`calls/frame ${(res.calls / res.frames).toFixed(1)}  fps(swiftshader) ${((res.frames * 1000) / res.ms).toFixed(1)}`);
console.log('top draws (fn:count → per frame):', JSON.stringify(perFrame.slice(0, 25)));
const glb = Object.entries(bytes).filter(([k]) => k.endsWith('.glb'));
console.log('GLB', JSON.stringify(glb), 'total', glb.reduce((a, [, v]) => a + v, 0));
console.log('all bytes', Object.values(bytes).reduce((a, v) => a + v, 0));
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.close();
