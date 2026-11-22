import { useId, type CSSProperties } from 'react';
import { COMPOUND_STYLE, type CompoundKey } from './theme';

/**
 * Generic tyre-compound disc: black tread, coloured sidewall band with ring
 * text, silver rim and a big compound letter on the hub. No manufacturer marks.
 */
export default function CompoundDisc({
  compound,
  size,
  color,
  label,
  ring,
  className = '',
  style,
}: {
  compound: CompoundKey;
  /** CSS size (px number or any CSS length) */
  size: number | string;
  /** override band colour (team-colour variant) */
  color?: string;
  /** override hub label (default: the compound name) */
  label?: string;
  /** override ring text */
  ring?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = COMPOUND_STYLE[compound];
  const band = color ?? s.color;
  const text = ring ?? `${compound} · ${s.tagline} · GHOSTLAP 26 · `;
  const hub = label ?? compound;
  const sz = typeof size === 'number' ? `${size}px` : size;
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: sz, height: sz, ...style }}>
      <svg viewBox="0 0 200 200" className="block h-full w-full drop-shadow-[0_10px_14px_rgba(0,0,0,0.28)]" aria-hidden>
        <defs>
          <radialGradient id={`rim${raw}`} cx="42%" cy="38%" r="70%">
            <stop offset="0" stopColor="#f4f6f8" />
            <stop offset="0.55" stopColor="#9aa1aa" />
            <stop offset="1" stopColor="#4a5058" />
          </radialGradient>
          <radialGradient id={`hub${raw}`} cx="45%" cy="40%" r="65%">
            <stop offset="0" stopColor="#2a2f37" />
            <stop offset="1" stopColor="#0c0f14" />
          </radialGradient>
          <path id={`rp${raw}`} d="M100,100 m-79,0 a79,79 0 1,1 158,0 a79,79 0 1,1 -158,0" />
        </defs>
        {/* tyre + tread */}
        <circle cx="100" cy="100" r="99" fill="#14161a" />
        <circle cx="100" cy="100" r="95.5" fill="none" stroke="#24272d" strokeWidth="5" strokeDasharray="5 4" />
        {/* sidewall band */}
        <circle cx="100" cy="100" r="79" fill="none" stroke={band} strokeWidth="21" />
        <text fontFamily="Anton, Impact, sans-serif" fontSize="12.5" letterSpacing="1.4" fill={s.ink === '#FFFFFF' && !color ? '#fff' : '#0b0d10'} dominantBaseline="central">
          <textPath href={`#rp${raw}`} startOffset="0">
            {text}
            {text}
          </textPath>
        </text>
        {/* rim */}
        <circle cx="100" cy="100" r="67" fill={`url(#rim${raw})`} />
        <circle cx="100" cy="100" r="58" fill={`url(#hub${raw})`} />
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x="98" y="44" width="4" height="15" rx="2" fill="#5c636d" transform={`rotate(${i * 36} 100 100)`} />
        ))}
        <circle cx="100" cy="100" r="40" fill={band} />
        <text x="100" y="98" textAnchor="middle" dominantBaseline="central" fontFamily="Anton, Impact, sans-serif" fontSize="44" fill={s.ink === '#FFFFFF' && !color ? '#fff' : '#0b0d10'}>
          {s.letter}
        </text>
        <text x="100" y="127" textAnchor="middle" fontFamily="Anton, Impact, sans-serif" fontSize="7.5" letterSpacing="1.2" fill={s.ink === '#FFFFFF' && !color ? '#fff' : '#0b0d10'}>
          {hub}
        </text>
      </svg>
    </div>
  );
}
