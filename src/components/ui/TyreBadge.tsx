import { useId } from 'react';
import type { Compound } from '@/types';

/**
 * Side-on F1 tyre in the Pirelli style: black tyre, compound colour as two sidewall arcs
 * (left + right), "PIRELLI" over the top and "P ZERO" under the bottom in the compound
 * colour, silver multi-spoke wheel. Pure SVG — scales from a 16px timing chip to a hero disc.
 * Below ~40px the lettering is dropped (it would be unreadable) and the arcs thicken.
 */
export const TYRE_COLORS: Record<Compound, string> = {
  SOFT: '#E8002D',
  MEDIUM: '#FFD12E',
  HARD: '#F0F0EC',
  INTERMEDIATE: '#43B02A',
  WET: '#0067AD',
};

export const TYRE_LETTER: Record<Compound, string> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };

export default function TyreBadge({
  compound,
  size = 64,
  worn = 0,
  spin = 0,
  letter = false,
  className = '',
  title,
}: {
  compound: Compound;
  /** rendered width/height in px */
  size?: number;
  /** 0..1 — fades the sidewall colour toward grey as the tyre ages */
  worn?: number;
  /** wheel rotation in degrees (rim + lettering turn together) */
  spin?: number;
  /** show the compound letter on the hub instead of the hub nut (good for small chips) */
  letter?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const col = TYRE_COLORS[compound] ?? '#888';
  const detail = size >= 40;
  const w = Math.max(0, Math.min(1, worn));
  const bandOpacity = 1 - w * 0.65;
  const spokes = 10;

  // sidewall arcs: right (−55°..55°) and left (125°..235°), around r = 39
  const R = 39;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [50 + R * Math.cos((a * Math.PI) / 180), 50 + R * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title ?? `${compound.toLowerCase()} tyre`}
    >
      <defs>
        <radialGradient id={`rim-${uid}`} cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#F4F5F6" />
          <stop offset="55%" stopColor="#B9BEC4" />
          <stop offset="100%" stopColor="#6E747B" />
        </radialGradient>
        <radialGradient id={`rub-${uid}`} cx="50%" cy="45%" r="55%">
          <stop offset="70%" stopColor="#1B1C1F" />
          <stop offset="100%" stopColor="#0A0A0C" />
        </radialGradient>
        {/* text paths: top arc runs left→right over the top, bottom arc left→right under the bottom */}
        <path id={`top-${uid}`} d="M 18 50 A 32 32 0 0 1 82 50" />
        <path id={`bot-${uid}`} d="M 14.5 50 A 35.5 35.5 0 0 0 85.5 50" />
      </defs>

      {/* tyre */}
      <circle cx="50" cy="50" r="49" fill={`url(#rub-${uid})`} />
      <circle cx="50" cy="50" r="46.5" fill="none" stroke="#26282C" strokeWidth="1.2" />

      <g transform={`rotate(${spin} 50 50)`}>
        {/* compound bands */}
        <g stroke={col} strokeOpacity={bandOpacity} strokeWidth={detail ? 3.4 : 6} strokeLinecap="round" fill="none">
          <path d={arc(-52, 52)} />
          <path d={arc(128, 232)} />
        </g>

        {detail && (
          <g fill={col} fillOpacity={bandOpacity} fontFamily="'Arial Black','Helvetica Neue',Arial,sans-serif" fontWeight="900" fontStyle="italic">
            <text fontSize="9.5" letterSpacing="0.6" textAnchor="middle">
              <textPath href={`#top-${uid}`} startOffset="50%">
                PIRELLI
              </textPath>
            </text>
            <text fontSize="10" letterSpacing="0.4" textAnchor="middle">
              <textPath href={`#bot-${uid}`} startOffset="50%">
                P ZERO
              </textPath>
            </text>
          </g>
        )}

        {/* wheel rim */}
        <circle cx="50" cy="50" r="25.5" fill="#2A2D31" />
        <circle cx="50" cy="50" r="24" fill={`url(#rim-${uid})`} />
        <circle cx="50" cy="50" r="19.5" fill="#3A3E44" />
        {Array.from({ length: spokes }, (_, i) => (
          <rect
            key={i}
            x="48.4"
            y="31"
            width="3.2"
            height="13"
            rx="1.4"
            fill={`url(#rim-${uid})`}
            transform={`rotate(${(i * 360) / spokes} 50 50)`}
          />
        ))}
        <circle cx="50" cy="50" r="7.2" fill={`url(#rim-${uid})`} stroke="#5B6168" strokeWidth="0.8" />
      </g>

      {letter && !detail ? (
        <>
          <circle cx="50" cy="50" r="30" fill="#111316" />
          <text x="50" y="65" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="'JetBrains Mono',monospace" fill={col} fillOpacity={bandOpacity}>
            {TYRE_LETTER[compound]}
          </text>
        </>
      ) : letter ? (
        <text x="50" y="54.2" textAnchor="middle" fontSize="11" fontWeight="900" fontFamily="'JetBrains Mono',monospace" fill="#111">
          {TYRE_LETTER[compound]}
        </text>
      ) : (
        <circle cx="50" cy="50" r="2.6" fill="#2A2D31" />
      )}
    </svg>
  );
}
