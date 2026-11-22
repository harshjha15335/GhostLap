import { useEffect, useRef, type RefObject } from 'react';

/**
 * Lerped-scroll frame loop for the DOM flow sections.
 *
 * Native scrolling is left alone; each frame `y` eases toward `window.scrollY`
 * (critically damped, ~120 ms) and every *awake* subscriber gets a callback to
 * write CSS transforms. A section is awake while it is within one viewport of
 * the screen (IntersectionObserver), and the rAF loop only runs while at least
 * one section is awake — so nothing ticks while the 3D chapters are on screen.
 */
export interface MotionFrame {
  /** smoothed scrollY */
  y: number;
  /** native scrollY */
  ty: number;
  vw: number;
  vh: number;
  /** seconds since loop start (0 under reduced motion) */
  t: number;
  dt: number;
  reduced: boolean;
}
export type MotionFn = (f: MotionFrame) => void;

interface Entry {
  fn: MotionFn;
  awake: boolean;
}

const entries = new Set<Entry>();
const frame: MotionFrame = { y: 0, ty: 0, vw: 1440, vh: 900, t: 0, dt: 0.016, reduced: false };
let raf = 0;
let last = 0;
let t0 = 0;
let mq: MediaQueryList | null = null;

function tick(now: number) {
  raf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  frame.dt = dt;
  frame.ty = window.scrollY;
  frame.vw = document.documentElement.clientWidth || window.innerWidth;
  frame.vh = window.innerHeight;
  frame.reduced = !!mq?.matches;
  if (frame.reduced) {
    frame.y = frame.ty;
    frame.t = 0;
  } else {
    const k = 1 - Math.exp(-dt * 11);
    frame.y += (frame.ty - frame.y) * k;
    if (Math.abs(frame.ty - frame.y) < 0.05) frame.y = frame.ty;
    // never lag more than a screen behind (fast jumps / anchor links)
    if (Math.abs(frame.ty - frame.y) > frame.vh) frame.y = frame.ty - Math.sign(frame.ty - frame.y) * frame.vh;
    frame.t = (now - t0) / 1000;
  }
  let any = false;
  entries.forEach((e) => {
    if (!e.awake) return;
    any = true;
    e.fn(frame);
  });
  if (any) raf = requestAnimationFrame(tick);
}

function wake() {
  if (raf || typeof window === 'undefined') return;
  if (!mq) mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const now = performance.now();
  if (!t0) t0 = now;
  if (!last || now - last > 200) frame.y = window.scrollY; // resume without a long glide
  last = now;
  raf = requestAnimationFrame(tick);
}

/** Run `fn` every frame while `ref` is within ~1 viewport of the screen. */
export function useFlowFrame(ref: RefObject<HTMLElement>, fn: MotionFn) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const entry: Entry = { fn: (f) => fnRef.current(f), awake: false };
    entries.add(entry);
    const io = new IntersectionObserver(
      ([e]) => {
        entry.awake = e.isIntersecting;
        if (entry.awake) wake();
      },
      { rootMargin: '100% 0px 100% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      entries.delete(entry);
      if (!entries.size && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
  }, [ref]);
}

/** Document-space top of an element (stable while the page scrolls). */
export function docTop(el: HTMLElement): number {
  return el.getBoundingClientRect().top + window.scrollY;
}

/**
 * Cached document-space box of `ref` (top/height), re-measured when the page
 * layout changes — so frame callbacks never force a synchronous layout.
 */
export function useDocBox(ref: RefObject<HTMLElement>) {
  const box = useRef({ top: 0, height: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      box.current.top = r.top + window.scrollY;
      box.current.height = Math.max(1, r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    const t = window.setTimeout(measure, 600);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.clearTimeout(t);
    };
  }, [ref]);
  return box;
}

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const ease = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
