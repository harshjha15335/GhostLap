import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RosterEntry } from './roster';
import { mediaSrcSet, mediaUrl, type DriverMedia } from './driverMedia';
import { useRevealEngine } from './revealContext';
import { placeholderReveal } from './placeholderArt';

/** head circle used before / without a media manifest entry (matches the pipeline's framing) */
const DEFAULT_HEAD = { cx: 0.5, cy: 0.24, r: 0.155 };

/**
 * A driver portrait frame with the helmet reveal. Pointer: the reveal follows the cursor.
 * Touch: tap (or press and hold, then drag) opens it at the finger; tap again closes it.
 * Keyboard focus opens it centred on the head. Reduced motion: a plain crossfade.
 */
export function RevealFrame({
  entry,
  media,
  variant,
  reducedMotion,
  onOpen,
  eager = false,
}: {
  entry: RosterEntry;
  media: DriverMedia;
  variant: 'card' | 'hero';
  reducedMotion: boolean;
  onOpen?: () => void;
  eager?: boolean;
}) {
  const { driver, team } = entry;
  const engine = useRevealEngine();
  const frameRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const helmetRef = useRef<HTMLImageElement>(null);
  const [placeholder, setPlaceholder] = useState<HTMLCanvasElement | null>(null);
  const [placeholderUrl, setPlaceholderUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // touch toggle + reduced-motion state
  const touch = useRef<{ id: number; wasOpen: boolean } | null>(null);
  const suppressClick = useRef(false);
  const useGl = !reducedMotion && engine?.mode === 'gl';
  const useCss = !reducedMotion && !!engine && engine.mode === 'css';

  // build the labelled stand-in when there is no helmet image
  useEffect(() => {
    if (media.helmet) return;
    let alive = true;
    void placeholderReveal(driver.code, driver.number, team.color).then((c) => {
      if (!alive) return;
      setPlaceholder(c);
      setPlaceholderUrl(c.toDataURL('image/webp', 0.85));
    });
    return () => {
      alive = false;
    };
  }, [media.helmet, driver.code, driver.number, team.color]);

  const source = useCallback(async (): Promise<TexImageSource | null> => {
    if (!media.helmet) return placeholder;
    const img = helmetRef.current;
    if (!img) return null;
    if (img.loading === 'lazy') img.loading = 'eager';
    try {
      await img.decode();
    } catch {
      return null;
    }
    return img;
  }, [media.helmet, placeholder]);

  const head = media.align ?? DEFAULT_HEAD;
  // brush a little larger than the head circle, so a cursor on the face floods most of it
  const radius = head.r * (variant === 'hero' ? 1.05 : 1.15);

  const start = useCallback(
    (clientX: number, clientY: number) => {
      const el = frameRef.current;
      if (!el || !engine) return;
      const target = { el, layer: layerRef.current, source: null as TexImageSource | null, key: `${driver.code}:${media.helmet ? 'h' : 'p'}`, radius, head };
      engine.activate(target, clientX, clientY);
      void source().then((s) => {
        target.source = s;
      });
    },
    [engine, driver.code, media.helmet, radius, head, source],
  );

  const headPoint = useCallback(() => {
    const r = frameRef.current!.getBoundingClientRect();
    return [r.left + head.cx * r.width, r.top + head.cy * r.height] as const;
  }, [head]);

  // crossfade for reduced motion (WAAPI, so the global reduced-motion CSS rule doesn't zero it)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !reducedMotion) return;
    layer.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' });
  }, [open, reducedMotion]);

  // close if another card takes over the shared engine
  useEffect(() => {
    if (!open || !engine || reducedMotion) return;
    const id = window.setInterval(() => {
      if (frameRef.current && !engine.isActiveFor(frameRef.current)) setOpen(false);
    }, 250);
    return () => window.clearInterval(id);
  }, [open, engine, reducedMotion]);

  const onPointerEnter = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (reducedMotion) setOpen(true);
    else start(e.clientX, e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (reducedMotion || !engine || !frameRef.current) return;
    if (e.pointerType === 'touch' && !touch.current) return;
    if (engine.isActiveFor(frameRef.current)) engine.move(e.clientX, e.clientY);
  };
  const onPointerLeave = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (reducedMotion) setOpen(false);
    else engine?.release(frameRef.current ?? undefined);
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    suppressClick.current = true;
    const el = frameRef.current!;
    const wasOpen = reducedMotion ? open : !!engine?.isActiveFor(el);
    touch.current = { id: e.pointerId, wasOpen };
    if (wasOpen) return;
    setOpen(true);
    // a tap opens the reveal centred on the face; holding and dragging then steers it
    if (!reducedMotion) {
      const [x, y] = headPoint();
      start(x, y);
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || !touch.current) return;
    if (touch.current.wasOpen) {
      setOpen(false);
      if (!reducedMotion) engine?.release(frameRef.current ?? undefined);
    }
    touch.current = null;
  };
  const onPointerCancel = () => {
    // the browser took the gesture for scrolling: keep the reveal as it is
    touch.current = null;
  };
  const onFocus = () => {
    const el = frameRef.current;
    if (!el || !el.matches(':focus-visible')) return;
    if (reducedMotion) setOpen(true);
    else {
      const [x, y] = headPoint();
      start(x, y);
    }
  };
  const onBlur = () => {
    if (reducedMotion) setOpen(false);
    else engine?.release(frameRef.current ?? undefined);
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen?.();
  };

  const portrait = media.portrait;
  const helmet = media.helmet;
  const sizes = variant === 'hero' ? '(min-width: 1024px) 34vw, 90vw' : '(min-width: 1280px) 15vw, (min-width: 768px) 24vw, 46vw';
  const big = (img: NonNullable<DriverMedia['portrait']>) => img.sizes[img.sizes.length - 1];

  // reveal layer visibility: GL draws on its own canvas; CSS fallback masks this layer
  const layerStyle: React.CSSProperties = useGl
    ? { opacity: 0 }
    : useCss
      ? {
          WebkitMaskImage: 'radial-gradient(circle var(--rr, 0px) at var(--rx, 50%) var(--ry, 30%), #000 96%, transparent 100%)',
          maskImage: 'radial-gradient(circle var(--rr, 0px) at var(--rx, 50%) var(--ry, 30%), #000 96%, transparent 100%)',
        }
      : { opacity: 0 };

  return (
    <button
      ref={frameRef}
      type="button"
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      onContextMenu={(e) => suppressClick.current && e.preventDefault()}
      aria-label={`${driver.fullName}, ${team.name}. ${helmet ? 'Hover the face, tap or focus to reveal the 2026 helmet.' : '2026 helmet image coming soon.'} Open season stats.`}
      className={`group relative block aspect-[4/5] w-full touch-pan-y select-none overflow-hidden border-ink bg-cream text-left [-webkit-touch-callout:none] ${
        variant === 'hero' ? 'rounded-2xl border-[3px] shadow-sticker-lg' : 'rounded-xl border-2 shadow-sticker'
      }`}
      style={{ ['--team' as string]: team.color }}
    >
      {/* team sheet behind the cut-out */}
      <span aria-hidden className="pop-dots absolute inset-0" style={{ backgroundColor: team.color }} />
      <span aria-hidden className="pop-halftone" />

      {portrait ? (
        <img
          src={mediaUrl(driver.code, 'portrait', big(portrait))}
          srcSet={mediaSrcSet(driver.code, 'portrait', portrait)}
          sizes={sizes}
          width={portrait.w}
          height={portrait.h}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          alt={`${driver.fullName} portrait`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <PortraitPlaceholder code={driver.code} number={driver.number} name={driver.lastName} hero={variant === 'hero'} />
      )}

      <div ref={layerRef} aria-hidden className="pointer-events-none absolute inset-0" style={layerStyle}>
        {helmet ? (
          <img
            ref={helmetRef}
            src={mediaUrl(driver.code, 'helmet', big(helmet))}
            srcSet={mediaSrcSet(driver.code, 'helmet', helmet)}
            sizes={sizes}
            width={helmet.w}
            height={helmet.h}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          placeholderUrl && <img src={placeholderUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>

      {/* number sticker */}
      <span
        aria-hidden
        className={`absolute left-2 top-2 z-[21] -rotate-3 rounded-md border-2 border-ink bg-cream px-1.5 font-display leading-tight text-ink shadow-sticker-sm ${
          variant === 'hero' ? 'text-3xl' : 'text-xl'
        }`}
      >
        {driver.number}
      </span>
    </button>
  );
}

function PortraitPlaceholder({ code, number, name, hero }: { code: string; number: number; name: string; hero: boolean }) {
  return (
    <span aria-hidden className="absolute inset-0 flex flex-col items-center justify-center text-cream">
      <span className={`font-display leading-none [text-shadow:0.05em_0.06em_0_#170F33] ${hero ? 'text-[11rem]' : 'text-[5.5rem]'}`}>{code}</span>
      <span className={`mt-1 font-display uppercase tracking-wide text-ink ${hero ? 'text-3xl' : 'text-lg'}`}>{name}</span>
      <span className="absolute bottom-2 right-2 rotate-2 whitespace-nowrap rounded-[3px] border-[1.5px] border-ink bg-cream px-1 font-mono text-[7px] font-semibold uppercase tracking-[0.12em] text-ink sm:text-[8px]">
        {hero ? `portrait not supplied · #${number}` : 'no portrait'}
      </span>
    </span>
  );
}
