import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

/**
 * Scroll choreography for long, chaptered pages that share one fixed WebGL scene.
 *
 * - Register each chapter <section> with `register(i)` (a stable ref callback).
 * - Every scroll / resize the hook measures and writes a mutable `state` object
 *   (no React re-render). 3D code reads `state.current` inside `useFrame`;
 *   DOM code can `subscribe()` or use the CSS custom properties written on each
 *   section: `--p` (0..1 progress through the section) and `--enter` (0..1 as it
 *   scrolls in from the bottom of the viewport).
 * - Only the active chapter index is React state (changes a handful of times).
 *
 * Progress definitions (scrollY = window.scrollY, vh = innerHeight):
 *   local   (scrollY - top) / span    where span = min(height, maxScroll - top)
 *   enter   (scrollY - (top - vh)) / vh
 *   coord   chapterIndex + local  (continuous 0..count)
 */
export interface ChapterProgress {
  /** document offset of the section top, px */
  top: number;
  height: number;
  /** 0..1 progress through the section's reachable scroll span */
  progress: number;
  /** 0..1 as the section top travels from viewport bottom to viewport top */
  enter: number;
  /** section intersects the viewport */
  visible: boolean;
}

export interface ChoreoState {
  scrollY: number;
  maxScroll: number;
  vw: number;
  vh: number;
  /** whole-page progress 0..1 */
  global: number;
  /** continuous chapter coordinate: index + local progress */
  coord: number;
  active: number;
  /** px per second, signed, lightly smoothed */
  velocity: number;
  reducedMotion: boolean;
  chapters: ChapterProgress[];
}

export interface ScrollChoreography {
  state: MutableRefObject<ChoreoState>;
  /** stable ref callbacks, one per chapter */
  register: (index: number) => (el: HTMLElement | null) => void;
  /** per-update DOM listener; returns an unsubscribe fn */
  subscribe: (fn: (s: ChoreoState) => void) => () => void;
  /** force a re-measure (e.g. after a layout change that ResizeObserver can't see) */
  remeasure: () => void;
  active: number;
  reducedMotion: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function initial(count: number): ChoreoState {
  return {
    scrollY: 0,
    maxScroll: 1,
    vw: typeof window === 'undefined' ? 1440 : window.innerWidth,
    vh: typeof window === 'undefined' ? 900 : window.innerHeight,
    global: 0,
    coord: 0,
    active: 0,
    velocity: 0,
    reducedMotion: false,
    chapters: Array.from({ length: count }, () => ({ top: 0, height: 1, progress: 0, enter: 0, visible: false })),
  };
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function useScrollChoreography(count: number): ScrollChoreography {
  const state = useRef<ChoreoState>(initial(count));
  const els = useRef<(HTMLElement | null)[]>([]);
  const listeners = useRef(new Set<(s: ChoreoState) => void>());
  const measureRef = useRef<() => void>(() => {});
  const [active, setActive] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  state.current.reducedMotion = reducedMotion;

  const callbacks = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => (el: HTMLElement | null) => {
        els.current[i] = el;
      }),
    [count],
  );
  const register = useCallback((i: number) => callbacks[i], [callbacks]);

  const subscribe = useCallback((fn: (s: ChoreoState) => void) => {
    listeners.current.add(fn);
    fn(state.current);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const remeasure = useCallback(() => measureRef.current(), []);

  useEffect(() => {
    const s = state.current;
    if (s.chapters.length !== count) s.chapters = initial(count).chapters;
    let raf = 0;
    let lastY = window.scrollY;
    let lastT = performance.now();
    let activeIdx = -1;

    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      const inst = ((y - lastY) / dt) * 1000;
      s.velocity = s.velocity * 0.7 + inst * 0.3;
      lastY = y;
      lastT = now;

      s.scrollY = y;
      s.global = clamp01(y / Math.max(1, s.maxScroll));
      let coord = 0;
      for (let i = 0; i < s.chapters.length; i++) {
        const c = s.chapters[i];
        const span = Math.max(1, Math.min(c.height, s.maxScroll - c.top));
        c.progress = clamp01((y - c.top) / span);
        c.enter = clamp01((y - (c.top - s.vh)) / s.vh);
        c.visible = c.top < y + s.vh && c.top + c.height > y;
        if (y >= c.top - 0.5) {
          coord = i + c.progress;
        }
        const el = els.current[i];
        if (el) {
          el.style.setProperty('--p', c.progress.toFixed(4));
          el.style.setProperty('--enter', c.enter.toFixed(4));
        }
      }
      s.coord = coord;
      // "active" flips when a chapter's top crosses the middle of the viewport
      let mid = 0;
      for (let i = 0; i < s.chapters.length; i++) if (s.chapters[i].top <= y + s.vh * 0.5) mid = i;
      s.active = mid;
      if (mid !== activeIdx) {
        activeIdx = mid;
        setActive(mid);
      }
      listeners.current.forEach((fn) => fn(s));
    };

    const measure = () => {
      s.vw = document.documentElement.clientWidth || window.innerWidth;
      s.vh = window.innerHeight;
      s.maxScroll = Math.max(1, document.documentElement.scrollHeight - s.vh);
      const y = window.scrollY;
      for (let i = 0; i < count; i++) {
        const el = els.current[i];
        const c = s.chapters[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        c.top = r.top + y;
        c.height = Math.max(1, r.height);
      }
      update();
    };
    measureRef.current = measure;

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onResize = () => measure();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => measure());
    els.current.forEach((el) => el && ro.observe(el));
    ro.observe(document.body);
    measure();
    // fonts / lazy content may shift layout after first paint
    const t1 = window.setTimeout(measure, 250);
    const t2 = window.setTimeout(measure, 1200);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (raf) cancelAnimationFrame(raf);
      measureRef.current = () => {};
    };
  }, [count]);

  return { state, register, subscribe, remeasure, active, reducedMotion };
}

/** Hermite smoothstep on [0,1]. */
export function smooth01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Map v from [a,b] to [0,1], clamped. */
export function range01(v: number, a: number, b: number): number {
  return clamp01((v - a) / (b - a || 1));
}
