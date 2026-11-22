import { useEffect, useRef } from 'react';

/**
 * Site-wide die-cut sticker cursor: a cream arrow, swapping to a cream pointing hand over
 * anything clickable and while the button is held. Mouse / fine pointers only — touch keeps
 * the native behaviour. One listener + one rAF tick per pointer move; no React re-renders.
 */
const INTERACTIVE = 'a,button,[role="button"],select,label,summary,input[type="range"],input[type="checkbox"],[data-hotspot],.cursor-pointer,.cursor-grab';

export default function StickerCursor() {
  const root = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);
  const hand = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || !arrow.current || !hand.current) return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!fine.matches) return;
    const html = document.documentElement;
    html.classList.add('sticker-cursor');

    let x = -100;
    let y = -100;
    let over = false;
    let down = false;
    let raf = 0;

    const paint = () => {
      raf = 0;
      const handOn = over || down;
      arrow.current!.style.display = handOn ? 'none' : 'block';
      hand.current!.style.display = handOn ? 'block' : 'none';
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${down ? 0.88 : 1})`;
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      const t = e.target as Element | null;
      over = !!t?.closest?.(INTERACTIVE);
      el.style.opacity = '1';
      queue();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      down = true;
      queue();
    };
    const onUp = () => {
      down = false;
      queue();
    };
    const onLeave = () => {
      el.style.opacity = '0';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('blur', onUp);
    html.addEventListener('pointerleave', onLeave);
    return () => {
      html.classList.remove('sticker-cursor');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onUp);
      html.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={root}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[9999] opacity-0 transition-opacity duration-150"
      style={{ willChange: 'transform', transformOrigin: '0 0' }}
    >
      {/* arrow: tip at (3,2) */}
      <svg ref={arrow} width="40" height="46" viewBox="0 0 46 54" className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_5px_8px_rgba(0,0,0,0.45)]">
        <path d="M3 2 L43 30 L25 33 L33 50 L25 53 L17 36 L4 47 Z" fill="#FBF6EA" />
        <path
          d="M7.5 8.5 L36 28.2 L21.8 30.6 L29.2 45.6 L26.2 47 L18.8 31.8 L8.4 40.2 Z"
          fill="#E6D7B6"
          stroke="#B9A57E"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M10 13 L30 27" stroke="#FBF6EA" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
      </svg>
      {/* pointing hand: fingertip at (19,2) */}
      <svg
        ref={hand}
        width="42"
        height="48"
        viewBox="0 0 46 54"
        className="-translate-x-[17px] -translate-y-[2px] drop-shadow-[0_5px_8px_rgba(0,0,0,0.45)]"
        style={{ display: 'none' }}
      >
        <path
          d="M19 1.5c-3.3 0-5.6 2.4-5.6 5.6v16.2l-2.1-2c-2.4-2.3-6-2.3-8.2-.1-2.1 2.1-2 5.5.1 7.7l9.6 11.2c2.8 3.3 5.7 6.6 9.6 8.6 2.4 1.2 5 1.8 7.7 1.8h2.7c7.4 0 12.2-5.5 12.2-12.7V25.4c0-3-2.3-5.3-5.2-5.3-1 0-1.9.3-2.7.8-.6-2.5-2.8-4.3-5.4-4.3-1.2 0-2.3.4-3.2 1-.8-2.2-2.9-3.7-5.3-3.7-.8 0-1.6.2-2.3.5V7.1c0-3.2-2.4-5.6-5.6-5.6z"
          fill="#FBF6EA"
        />
        <path
          d="M19 5.3c-1.2 0-1.9.8-1.9 1.9v21.3l-1.3.6-7-6.6c-.9-.8-2.2-.8-3 0-.8.8-.8 2 0 2.9l9.7 11.4c2.7 3.1 5.2 6 8.6 7.7 1.9 1 4 1.4 6.1 1.4h2.7c5.2 0 8.5-3.8 8.5-9V25.4c0-.9-.7-1.6-1.5-1.6s-1.6.7-1.6 1.6v5.1h-3.7v-9.3c0-1-.8-1.7-1.8-1.7-1 0-1.7.7-1.7 1.7v8.6H28V18.3c0-1-.8-1.8-1.8-1.8s-1.7.8-1.7 1.8v11.1h-3.7V7.2c0-1.1-.7-1.9-1.8-1.9z"
          fill="#E6D7B6"
          stroke="#B9A57E"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
