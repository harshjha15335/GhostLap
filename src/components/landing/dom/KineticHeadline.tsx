import { useEffect, useRef } from 'react';
import { tick } from './sound';

/**
 * Monumental headline where every letter is an independent damped spring.
 * Pointer proximity lifts / tilts / compresses letters; a tap kicks an impulse.
 * One rAF loop writes transforms directly (no React re-renders).
 */
interface Spring {
  y: number; vy: number;
  r: number; vr: number;
  sy: number; vsy: number;
}

const K = 260;
const C = 16;

export default function KineticHeadline({
  lines,
  reduced,
  className = '',
}: {
  lines: { text: string; className: string }[];
  reduced: boolean;
  className?: string;
}) {
  const root = useRef<HTMLHeadingElement>(null);
  const letters = useRef<HTMLSpanElement[]>([]);

  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    const els = letters.current.filter(Boolean);
    const springs: Spring[] = els.map(() => ({ y: 0, vy: 0, r: 0, vr: 0, sy: 1, vsy: 0 }));
    const pointer = { x: -9999, y: -9999, inside: false };
    let raf = 0;
    let last = performance.now();
    let idle = 0;
    let lastHit = -1;

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
      wake();
    };
    const onLeave = () => {
      pointer.inside = false;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
      els.forEach((l, i) => {
        const b = l.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
        const f = Math.max(0, 1 - d / (b.height * 1.2));
        if (f > 0) {
          springs[i].vy -= 900 * f;
          springs[i].vsy -= 9 * f;
          springs[i].vr += (e.clientX < b.left + b.width / 2 ? -1 : 1) * 260 * f;
        }
      });
      tick(1.2);
      wake();
    };

    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      let energy = 0;
      let hit = -1;
      els.forEach((l, i) => {
        const b = l.getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        let ty = 0;
        let tr = 0;
        let tsy = 1;
        if (pointer.inside) {
          const dx = pointer.x - cx;
          const dy = pointer.y - cy;
          const d = Math.hypot(dx / (b.width * 1.6), dy / b.height);
          const f = Math.max(0, 1 - d);
          if (f > 0) {
            ty = -b.height * 0.16 * f;
            tr = (dx / b.width) * 14 * f;
            tsy = 1 - 0.14 * f;
          }
          if (Math.abs(dx) < b.width / 2 && Math.abs(dy) < b.height / 2) hit = i;
        }
        const s = springs[i];
        s.vy += (-K * (s.y - ty) - C * s.vy) * dt;
        s.y += s.vy * dt;
        s.vr += (-K * (s.r - tr) - C * s.vr) * dt;
        s.r += s.vr * dt;
        s.vsy += (-K * 1.4 * (s.sy - tsy) - C * s.vsy) * dt;
        s.sy += s.vsy * dt;
        const sx = 1 + (1 - s.sy) * 0.6;
        l.style.transform = `translate3d(0, ${s.y.toFixed(2)}px, 0) rotate(${s.r.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${s.sy.toFixed(3)})`;
        energy += Math.abs(s.vy) + Math.abs(s.vr) + Math.abs(s.vsy) * 100 + Math.abs(s.y - ty) + Math.abs(s.r - tr);
      });
      if (hit !== lastHit) {
        if (hit >= 0) tick(0.8 + (hit % 5) * 0.08);
        lastHit = hit;
      }
      idle = energy < 0.5 && !pointer.inside ? idle + 1 : 0;
      raf = idle > 20 ? 0 : requestAnimationFrame(step);
    };
    const wake = () => {
      if (!raf) {
        last = performance.now();
        idle = 0;
        raf = requestAnimationFrame(step);
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      if (raf) cancelAnimationFrame(raf);
      els.forEach((l) => (l.style.transform = ''));
    };
  }, [reduced, lines]);

  let n = 0;
  return (
    <h1
      ref={root}
      className={`select-none font-display uppercase leading-[0.86] tracking-[-0.01em] ${className}`}
      style={{ touchAction: 'pan-y' }}
      aria-label={lines.map((l) => l.text).join(' ')}
    >
      {lines.map((line, li) => (
        <span key={li} className="block whitespace-nowrap" aria-hidden>
          {line.text.split(/( )/).map((word, wi) =>
            word === ' ' ? (
              <span key={wi} className="inline-block w-[0.22em]" />
            ) : (
              <span key={wi} className="inline-block whitespace-nowrap">
                {[...word].map((ch) => {
                  const idx = n++;
                  return (
                    <span
                      key={idx}
                      ref={(e) => {
                        if (e) letters.current[idx] = e;
                      }}
                      className={`kinetic-letter inline-block origin-bottom will-change-transform ${line.className}`}
                    >
                      {ch}
                    </span>
                  );
                })}
              </span>
            ),
          )}
        </span>
      ))}
    </h1>
  );
}
