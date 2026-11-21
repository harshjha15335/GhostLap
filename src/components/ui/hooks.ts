import { useEffect, useRef, useState, type RefObject } from 'react';
import type { RaceBundle } from '@/types';
import { loadRace } from '@/engine/dataLoader';

/** Reactive media query (SSR-safe default false). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

/** Device-pixel-ratio range for a <Canvas>: capped at 1.5 on mobile. */
export function useCanvasDpr(): [number, number] {
  const mobile = useIsMobile();
  return mobile ? [1, 1.5] : [1, 2];
}

/** true while the element is (near) the viewport — used to pause off-screen render loops. */
export function useInView<T extends Element>(rootMargin = '200px'): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, inView];
}

/**
 * Lazily loads race bundles for the given slugs (sequentially-ish, 3 at a time) and
 * returns whatever has arrived so far. Uses the shared loadRace cache.
 */
export function useRaceBundles(slugs: string[], enabled = true): { bundles: Record<string, RaceBundle>; done: boolean } {
  const [bundles, setBundles] = useState<Record<string, RaceBundle>>({});
  const [done, setDone] = useState(false);
  const key = slugs.join(',');
  useEffect(() => {
    if (!enabled || !slugs.length) return;
    let alive = true;
    const queue = [...slugs];
    let active = 0;
    let finished = 0;
    const pump = () => {
      while (alive && active < 3 && queue.length) {
        const slug = queue.shift()!;
        active++;
        loadRace(slug)
          .then((b) => alive && setBundles((prev) => ({ ...prev, [slug]: b })))
          .catch(() => undefined)
          .finally(() => {
            active--;
            finished++;
            if (alive && finished === slugs.length) setDone(true);
            pump();
          });
      }
    };
    pump();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { bundles, done };
}
