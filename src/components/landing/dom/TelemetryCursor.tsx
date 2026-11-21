import { useEffect, useRef } from 'react';
import type { LandingBus } from '../bus';

/**
 * Oversized cut-out pointer with a live delta readout driven by cursor speed:
 * move fast and you "gain" time (green, negative), crawl and you lose it.
 * Only mounted for fine pointers with hover; touch devices keep the native UI.
 */
export default function TelemetryCursor({ bus }: { bus: LandingBus }) {
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = root.current;
    const lab = label.current;
    if (!el || !lab) return;
    let x = -100;
    let y = -100;
    let px = x;
    let py = y;
    let speed = 0;
    let shown = false;
    let raf = 0;
    let lastT = performance.now();
    let delta = 0;
    let interactive = false;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      bus.pointer.x = (x / window.innerWidth) * 2 - 1;
      bus.pointer.y = -((y / window.innerHeight) * 2 - 1);
      bus.pointer.active = true;
      const t = e.target as HTMLElement | null;
      interactive = !!t?.closest('a,button,[data-hotspot]');
      if (!shown) {
        shown = true;
        px = x;
        py = y;
        el.style.opacity = '1';
      }
    };
    const onLeave = () => {
      shown = false;
      el.style.opacity = '0';
    };
    const loop = (now: number) => {
      const dt = Math.max(1, now - lastT);
      lastT = now;
      const inst = Math.hypot(x - px, y - py) / dt; // px per ms
      px = x;
      py = y;
      speed += (inst - speed) * 0.12;
      // map speed to a delta: >1.2 px/ms gains time
      const target = (0.6 - speed) * 0.42;
      delta += (target - delta) * 0.15;
      const d = Math.max(-0.999, Math.min(0.999, delta));
      lab.textContent = `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}s`;
      lab.dataset.gain = d <= 0 ? '1' : '0';
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${interactive ? 1.18 : 1})`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [bus]);

  return (
    <div
      ref={root}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] opacity-0 transition-opacity duration-200"
      style={{ willChange: 'transform' }}
    >
      <svg width="46" height="54" viewBox="0 0 46 54" className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)]">
        {/* die-cut sticker: white border, neon fill, black keyline */}
        <path d="M3 2 L43 30 L25 33 L33 50 L25 53 L17 36 L4 47 Z" fill="#F4F6F0" />
        <path d="M7 8 L36 28 L21.5 30.5 L29 46 L26 47.5 L18.5 31.5 L8 40 Z" fill="#D4FF00" stroke="#080B10" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <span
        ref={label}
        data-gain="1"
        className="tele-delta absolute left-[34px] top-[44px] whitespace-nowrap rounded-[3px] border-2 border-asphalt px-1.5 py-0.5 font-mono text-[12px] font-semibold tracking-tight"
      >
        +0.000s
      </span>
    </div>
  );
}
