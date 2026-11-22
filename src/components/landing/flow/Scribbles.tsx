import type { CSSProperties } from 'react';
import { C } from './theme';

/* Thin pencil-style race-engineer annotations: arrows, numbered markers, notes. */

const INK = C.green;

/**
 * Hand-drawn arrow: a gently wobbling curve from (0,0) to (w,h) bending by
 * `bend` (fraction of length, + = to the left of travel) with an open head.
 */
export function HandArrow({
  w,
  h,
  bend = 0.25,
  className = '',
  style,
  stroke = INK,
}: {
  w: number;
  h: number;
  bend?: number;
  className?: string;
  style?: CSSProperties;
  stroke?: string;
}) {
  const pad = 24;
  const len = Math.hypot(w, h);
  const nx = -h / len;
  const ny = w / len;
  const cx = w / 2 + nx * bend * len;
  const cy = h / 2 + ny * bend * len;
  // tangent at the end of a quadratic: end - control
  const tx = w - cx;
  const ty = h - cy;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const head = Math.min(34, len * 0.12);
  const a1x = w - ux * head - uy * head * 0.55;
  const a1y = h - uy * head + ux * head * 0.55;
  const a2x = w - ux * head + uy * head * 0.55;
  const a2y = h - uy * head - ux * head * 0.55;
  const minX = Math.min(0, w, cx) - pad;
  const minY = Math.min(0, h, cy) - pad;
  const vbW = Math.max(0, w, cx) - minX + pad;
  const vbH = Math.max(0, h, cy) - minY + pad;
  const d = `M0 0 Q${cx.toFixed(1)} ${cy.toFixed(1)} ${w} ${h}`;
  const d2 = `M${(1.5).toFixed(1)} 1 Q${(cx + 2).toFixed(1)} ${(cy - 1.5).toFixed(1)} ${w - 1} ${h + 1.2}`;
  return (
    <svg
      className={`fl-draw pointer-events-none absolute overflow-visible ${className}`}
      viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
      width={vbW}
      height={vbH}
      style={{ left: minX, top: minY, ...style }}
      aria-hidden
    >
      <g fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round">
        <path className="fl-ink" d={d} strokeWidth="1.6" style={{ ['--len' as string]: `${len * 1.3}` }} />
        <path d={d2} strokeWidth="0.7" opacity="0.5" />
        <path d={`M${a1x.toFixed(1)} ${a1y.toFixed(1)} L${w} ${h} L${a2x.toFixed(1)} ${a2y.toFixed(1)}`} strokeWidth="1.7" />
      </g>
    </svg>
  );
}

/** Pencil-circled step number (①②③). */
export function Marker({ n, size = 46, className = '', style }: { n: number; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} className={`pointer-events-none ${className}`} style={style} aria-hidden>
      <g fill="none" stroke={INK} strokeLinecap="round">
        <path d="M31 6 C46 5 55 17 54 31 C53 46 41 55 28 54 C14 53 6 42 7 29 C8 17 17 8 33 9" strokeWidth="1.8" />
        <path d="M44 9 C50 13 53 19 54 25" strokeWidth="1" opacity="0.6" />
        <path d="M47 14 l5 -4 M49 18 l6 -3 M51 23 l6 -2" strokeWidth="1" opacity="0.7" />
      </g>
      <text x="29" y="33" textAnchor="middle" dominantBaseline="central" fill={INK} className="fl-hand" fontSize="34" fontWeight="700">
        {n}
      </text>
    </svg>
  );
}

/** Handwritten note with the "T-square" bracket from the reference. */
export function Note({ lines, className = '', style, size = 22 }: { lines: string[]; className?: string; style?: CSSProperties; size?: number }) {
  return (
    <div className={`pointer-events-none absolute ${className}`} style={{ fontSize: size, ...style }}>
      <div className="relative" style={{ transform: 'rotate(-6deg)' }}>
        <span className="absolute -left-[0.5em] -top-[0.4em] h-[0.06em] w-[7.5em] rounded bg-current" style={{ color: INK, transform: 'rotate(-3deg)' }} />
        <span className="absolute -top-[0.7em] left-0 h-[4.2em] w-[0.06em] rounded bg-current" style={{ color: INK, transform: 'rotate(2deg)' }} />
        <div className="fl-hand pl-[0.6em] pt-[0.1em] leading-[0.95]" style={{ color: INK }}>
          {lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
