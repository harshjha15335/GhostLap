/**
 * Liquid "helmet reveal" for the Drivers page: one shared WebGL2 canvas that sits over
 * whichever card is active and draws that card's reveal image (helmet) through an
 * organic, hard-edged mask that trails the cursor.
 *
 * How the mask works (original implementation):
 *  - A small simulation texture (~160 px tall, ping-ponged) stores ink in R and a velocity
 *    field in G/B. Every frame the field is advected semi-Lagrangian style by its own
 *    velocity plus a slowly drifting curl-noise flow, damped, and the ink decays.
 *  - The cursor (smoothed with a critically-damped lerp) stamps a soft capsule from its
 *    previous to its current position, adding ink and pushing its own velocity into the
 *    field, so fast moves smear a liquid wake that curls and breaks up as it fades.
 *  - The composite pass adds fbm noise to the ink and thresholds it with a narrow
 *    smoothstep: the reveal has a crisp, antialiased, blobby edge, not a soft spotlight.
 *  - Entering ramps the brush radius up (grow); leaving stops stamping and raises the decay
 *    rate, so the shape erodes along its noisy edge (shrink). Once the ink is gone the loop
 *    stops and the canvas is hidden: idle cards cost nothing.
 *
 * Without WebGL2 (or after a context loss) the engine falls back to a CSS mask: it drives
 * --rx/--ry/--rr on the active card's reveal layer, which uses a radial-gradient mask-image.
 */

export interface RevealTarget {
  /** the card frame the reveal covers (portrait and reveal image share this frame) */
  el: HTMLElement;
  /** CSS-fallback layer inside `el` (mask driven by --rx/--ry/--rr) */
  layer: HTMLElement | null;
  /** image drawn by the WebGL path; must be decoded */
  source: TexImageSource | null;
  /** cache key for the uploaded texture */
  key: string;
  /** brush radius as a fraction of the frame height */
  radius: number;
}

type Mode = 'gl' | 'css';

const SIM_H = 160;
const MAX_DPR = 2;
const TEX_CACHE = 8;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const NOISE = `
vec3 hash3(vec2 p) {
  vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
  return fract(sin(q) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash3(i).x, b = hash3(i + vec2(1.0, 0.0)).x, c = hash3(i + vec2(0.0, 1.0)).x, d = hash3(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}`;

// state: R = ink, GB = velocity (frame-height units / s), stored raw (float) or biased (RGBA8)
const STEP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uState;
uniform float uAspect, uDt, uTime, uDecay, uRadius, uStamp, uBias;
uniform vec2 uP0, uP1, uVel;
${NOISE}
vec4 readState(vec2 uv) {
  vec4 s = texture(uState, uv);
  if (uBias > 0.5) s.gb = s.gb * 2.0 - 1.0;
  return s;
}
vec2 curl(vec2 p) {
  float e = 0.02;
  float n1 = fbm(p + vec2(0.0, e)), n2 = fbm(p - vec2(0.0, e));
  float n3 = fbm(p + vec2(e, 0.0)), n4 = fbm(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}
void main() {
  vec4 s = readState(vUv);
  vec2 flow = curl(vec2(vUv.x * uAspect, vUv.y) * 2.4 + uTime * 0.12) * 0.035;
  vec2 v = s.gb + flow;
  vec2 back = vUv - uDt * vec2(v.x / uAspect, v.y);
  vec4 a = readState(back);
  float ink = a.r * exp(-uDecay * uDt);
  vec2 vel = a.gb * exp(-2.6 * uDt);

  // capsule stamp from P0 to P1 (in aspect-corrected frame units)
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 ab = uP1 - uP0;
  float h = clamp(dot(p - uP0, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(p - uP0 - ab * h) / max(uRadius, 1e-4);
  float f = exp(-d * d * 2.2) * uStamp;
  ink = min(ink + f * uDt * 9.0, 1.35);
  vel += f * uVel * uDt * 6.0;
  vel = clamp(vel, -1.0, 1.0);

  o = vec4(ink, uBias > 0.5 ? vel * 0.5 + 0.5 : vel, 1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uState, uImage;
uniform float uAspect, uTime;
${NOISE}
void main() {
  float ink = texture(uState, vUv).r;
  vec2 q = vec2(vUv.x * uAspect, vUv.y);
  float n = fbm(q * 5.5 + vec2(uTime * 0.07, -uTime * 0.05));
  float m = ink + (n - 0.5) * 0.62;
  // pixel-exact antialiasing: the edge is ~1 device pixel wide however flat the ink is
  float w = max(fwidth(m) * 0.8, 1e-4);
  float a = smoothstep(-w, w, m - 0.42);
  vec4 c = texture(uImage, vec2(vUv.x, 1.0 - vUv.y));
  o = c * a;
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const u = new Map<string, WebGLUniformLocation | null>();
  return { p, u: (name: string) => (u.has(name) ? u.get(name)! : (u.set(name, gl.getUniformLocation(p, name)), u.get(name)!)) };
}

interface Fbo {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
}

export class RevealEngine {
  readonly canvas: HTMLCanvasElement;
  mode: Mode = 'css';
  private gl: WebGL2RenderingContext | null = null;
  private step!: ReturnType<typeof program>;
  private comp!: ReturnType<typeof program>;
  private state: Fbo[] = [];
  private simW = 0;
  private simH = 0;
  private float = true;
  private texCache = new Map<string, WebGLTexture>();

  private target: RevealTarget | null = null;
  private active = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private sinceRelease = 0;
  private enterT = 0;
  // cursor in frame units (x 0..aspect, y 0..1, y up), goal + smoothed
  private goal = { x: 0, y: 0 };
  private pos = { x: 0, y: 0 };
  private prev = { x: 0, y: 0 };
  private vel = { x: 0, y: 0 };
  private aspect = 0.8;
  private cssR = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      pointerEvents: 'none',
      zIndex: '20',
      display: 'none',
      transformOrigin: '0 0',
    } satisfies Partial<CSSStyleDeclaration>);
    try {
      this.initGl();
      this.mode = 'gl';
    } catch {
      this.gl = null;
      this.mode = 'css';
    }
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gl = null;
      this.texCache.clear();
      this.mode = 'css';
      this.canvas.style.display = 'none';
    });
  }

  private initGl() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.float = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.step = program(gl, STEP);
    this.comp = program(gl, COMPOSITE);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  private makeFbo(w: number, h: number): Fbo {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      if (this.float) {
        this.float = false;
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fb);
        return this.makeFbo(w, h);
      }
      throw new Error('fbo');
    }
    return { tex, fb };
  }

  /** (re)allocate and clear the simulation for the current frame aspect */
  private resetSim() {
    const gl = this.gl;
    if (!gl) return;
    const w = Math.max(8, Math.round(SIM_H * this.aspect));
    if (w !== this.simW || this.state.length !== 2) {
      for (const s of this.state) {
        gl.deleteTexture(s.tex);
        gl.deleteFramebuffer(s.fb);
      }
      this.simW = w;
      this.simH = SIM_H;
      this.state = [this.makeFbo(w, SIM_H), this.makeFbo(w, SIM_H)];
    }
    const bias = this.float ? 0 : 0.5;
    for (const s of this.state) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
      gl.clearColor(0, bias, bias, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  private texture(t: RevealTarget): WebGLTexture | null {
    const gl = this.gl;
    if (!gl || !t.source) return null;
    let tex = this.texCache.get(t.key);
    if (tex) {
      // LRU bump
      this.texCache.delete(t.key);
      this.texCache.set(t.key, tex);
      return tex;
    }
    tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.source);
    } catch {
      gl.deleteTexture(tex);
      return null;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texCache.set(t.key, tex);
    while (this.texCache.size > TEX_CACHE) {
      const [k, old] = this.texCache.entries().next().value as [string, WebGLTexture];
      gl.deleteTexture(old);
      this.texCache.delete(k);
    }
    return tex;
  }

  private toFrame(clientX: number, clientY: number, r: DOMRect) {
    return { x: ((clientX - r.left) / r.height), y: 1 - (clientY - r.top) / r.height };
  }

  /** Start revealing `t`; the brush jumps to (clientX, clientY). */
  activate(t: RevealTarget, clientX: number, clientY: number) {
    const switching = this.target?.el !== t.el;
    if (switching && this.target?.layer) this.clearCss(this.target.layer);
    this.target = t;
    const r = t.el.getBoundingClientRect();
    this.aspect = r.width / Math.max(1, r.height);
    const p = this.toFrame(clientX, clientY, r);
    if (switching || !this.raf) {
      this.goal = { ...p };
      this.pos = { ...p };
      this.prev = { ...p };
      this.vel = { x: 0, y: 0 };
      this.enterT = 0;
      this.cssR = 0;
      if (this.mode === 'gl') this.resetSim();
    }
    this.active = true;
    this.sinceRelease = 0;
    this.kick();
  }

  /** Move the brush goal (client coords). */
  move(clientX: number, clientY: number) {
    if (!this.target) return;
    this.goal = this.toFrame(clientX, clientY, this.target.el.getBoundingClientRect());
  }

  /** Stop stamping; the reveal erodes and the loop stops once it is gone. */
  release(el?: HTMLElement) {
    if (el && this.target?.el !== el) return;
    this.active = false;
  }

  isActiveFor(el: HTMLElement) {
    return this.active && this.target?.el === el;
  }

  private kick() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const t = this.target;
    if (!t || !t.el.isConnected) {
      this.stop();
      return;
    }
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.active) this.enterT += dt;
    else this.sinceRelease += dt;

    // critically-damped follow: snappy but liquid
    const k = 1 - Math.exp(-dt * 16);
    this.prev = { ...this.pos };
    this.pos.x += (this.goal.x - this.pos.x) * k;
    this.pos.y += (this.goal.y - this.pos.y) * k;
    const vx = (this.pos.x - this.prev.x) / dt;
    const vy = (this.pos.y - this.prev.y) / dt;
    this.vel.x += (vx - this.vel.x) * 0.5;
    this.vel.y += (vy - this.vel.y) * 0.5;

    const grow = 1 - Math.pow(1 - Math.min(1, this.enterT / 0.42), 3);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    const radius = t.radius * (0.55 + 0.45 * grow) * (1 + Math.min(0.35, speed * 0.18));

    const r = t.el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    const done = !this.active && this.sinceRelease > 1.1;

    if (this.mode === 'gl' && this.gl) {
      this.drawGl(t, r, dt, radius, onScreen);
    } else if (t.layer) {
      // CSS fallback: a lerped circle radius, no liquid edge
      const goalR = this.active ? radius : 0;
      this.cssR += (goalR - this.cssR) * (1 - Math.exp(-dt * (this.active ? 10 : 7)));
      t.layer.style.setProperty('--rx', `${(this.pos.x / this.aspect) * 100}%`);
      t.layer.style.setProperty('--ry', `${(1 - this.pos.y) * 100}%`);
      t.layer.style.setProperty('--rr', `${this.cssR * r.height}px`);
    }

    if (done) {
      this.stop();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawGl(t: RevealTarget, r: DOMRect, dt: number, radius: number, onScreen: boolean) {
    const gl = this.gl!;
    const c = this.canvas;
    const dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const aspect = r.width / Math.max(1, r.height);
    if (Math.abs(aspect - this.aspect) > 0.01) {
      this.aspect = aspect;
      this.resetSim();
    }
    c.style.width = `${r.width}px`;
    c.style.height = `${r.height}px`;
    c.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
    // round the corners like the card frame
    c.style.borderRadius = getComputedStyle(t.el).borderRadius;
    c.style.display = onScreen ? 'block' : 'none';

    const img = this.texture(t);
    gl.disable(gl.BLEND);

    // simulation step
    const [src, dst] = this.state;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.useProgram(this.step.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    const u = this.step.u;
    gl.uniform1i(u('uState'), 0);
    gl.uniform1f(u('uAspect'), this.aspect);
    gl.uniform1f(u('uDt'), dt);
    gl.uniform1f(u('uTime'), this.time);
    gl.uniform1f(u('uDecay'), this.active ? 1.5 : 3.6);
    gl.uniform1f(u('uRadius'), radius);
    gl.uniform1f(u('uStamp'), this.active && img ? 1 : 0);
    gl.uniform1f(u('uBias'), this.float ? 0 : 1);
    gl.uniform2f(u('uP0'), this.prev.x, this.prev.y);
    gl.uniform2f(u('uP1'), this.pos.x, this.pos.y);
    gl.uniform2f(u('uVel'), Math.max(-3, Math.min(3, this.vel.x)), Math.max(-3, Math.min(3, this.vel.y)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.state = [dst, src];

    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!img || !onScreen) return;
    gl.useProgram(this.comp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, img);
    const cu = this.comp.u;
    gl.uniform1i(cu('uState'), 0);
    gl.uniform1i(cu('uImage'), 1);
    gl.uniform1f(cu('uAspect'), this.aspect);
    gl.uniform1f(cu('uTime'), this.time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private clearCss(layer: HTMLElement) {
    layer.style.setProperty('--rr', '0px');
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.style.display = 'none';
    if (this.target?.layer) this.clearCss(this.target.layer);
    if (!this.active) this.target = null;
  }

  dispose() {
    this.stop();
    this.target = null;
    const gl = this.gl;
    if (gl) {
      for (const tex of this.texCache.values()) gl.deleteTexture(tex);
      for (const s of this.state) {
        gl.deleteTexture(s.tex);
        gl.deleteFramebuffer(s.fb);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.texCache.clear();
    this.canvas.remove();
  }
}
