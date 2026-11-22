import type { CSSProperties } from 'react';
import type { Compound } from '@/types';
import TyreBadge from '@/components/ui/TyreBadge';
import type { CompoundKey } from './theme';

const TO_COMPOUND: Record<CompoundKey, Compound> = {
  SOFT: 'SOFT',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
  INTER: 'INTERMEDIATE',
  WET: 'WET',
};

/**
 * Landing tyre-compound disc: the shared Pirelli-style <TyreBadge> (black tyre,
 * compound sidewall arcs, PIRELLI / P ZERO lettering, silver multi-spoke wheel)
 * sized to fill its box. `label` + `color` add a small hub tag (e.g. the
 * championship leader's code in team colour) on top of the real tyre artwork.
 */
export default function CompoundDisc({
  compound,
  size,
  color,
  label,
  spin = 0,
  className = '',
  style,
}: {
  compound: CompoundKey;
  /** CSS size (px number or any CSS length) */
  size: number | string;
  /** hub-tag colour (only drawn together with `label`) */
  color?: string;
  /** optional hub tag text */
  label?: string;
  /** kept for call-site compatibility; the Pirelli artwork has fixed sidewall text */
  ring?: string;
  /** kept for call-site compatibility */
  letter?: string;
  /** wheel rotation, degrees */
  spin?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const sz = typeof size === 'number' ? `${size}px` : size;
  // numeric sizes drive TyreBadge's small-size simplification; "100%" discs are large
  const px = typeof size === 'number' ? size : 200;
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: sz, height: sz, containerType: 'inline-size', ...style }}>
      <TyreBadge
        compound={TO_COMPOUND[compound]}
        size={px}
        spin={spin}
        className="block h-full w-full drop-shadow-[0_10px_14px_rgba(0,0,0,0.28)]"
      />
      {label && (
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-[#080B10] px-[0.6em] py-[0.15em] font-mono font-bold uppercase leading-none"
          style={{ background: color ?? '#F2F2F2', color: '#080B10', fontSize: 'max(8px, 7cqw)' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
