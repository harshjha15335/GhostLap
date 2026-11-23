import type { ReactNode } from 'react';
import { useIsMobile } from './hooks';
import type { RaceStatus } from '@/types';

/** Shared pit-wall UI primitives (Pit-Lane Pop sticker theme: ink text on bright sheets). */

export type Tone = 'ink' | 'lime';

/**
 * Section heading for the pop sheets. `tone="ink"` (default) for light sheets
 * (chalk / sunshine / magenta), `tone="lime"` (historic name) for the deep saturated
 * sheets (ultramarine / ultraviolet), where it switches to sunshine + chalk.
 */
export function SectionHeading({ kicker, title, children, tone = 'ink' }: { kicker: string; title: ReactNode; children?: ReactNode; tone?: Tone }) {
  const lime = tone === 'lime';
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div
          className={`inline-block -rotate-1 rounded-[4px] border-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.24em] ${
            lime ? 'border-cream bg-ink text-cream' : 'border-ink bg-cream text-ink'
          }`}
        >
          {kicker}
        </div>
        <h2 className={`mt-1.5 font-display text-4xl uppercase leading-[0.92] tracking-wide sm:text-5xl ${lime ? 'text-pop-sun' : 'text-ink'}`}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Giant condensed page title: chalk letters with a hard ink drop on a saturated sheet. */
export function PageTitle({ kicker, children, className = '' }: { kicker: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="inline-flex -rotate-2 items-center gap-2 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink shadow-sticker-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-ink" />
        {kicker}
      </div>
      <h1 className="mt-2 font-display text-[clamp(3.4rem,9vw,8rem)] uppercase leading-[0.84] tracking-[0.005em] text-cream [text-shadow:0.045em_0.055em_0_#170F33]">{children}</h1>
    </div>
  );
}

const statusStyle: Record<RaceStatus, string> = {
  completed: 'bg-pop-sun text-ink',
  cancelled: 'bg-[#D7102A] text-white',
  upcoming: 'bg-pop-sky text-ink',
};
const statusLabel: Record<RaceStatus, string> = { completed: 'Completed', cancelled: 'Cancelled', upcoming: 'Upcoming' };

/** Die-cut status sticker: flat colour, ink keyline, hard shadow, slight tilt. */
export function StatusBadge({ status }: { status: RaceStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 -rotate-2 items-center gap-1 rounded-[4px] border-[1.5px] border-ink px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] shadow-sticker-sm ${statusStyle[status]}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" />
      {statusLabel[status]}
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  label,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border-2 border-ink bg-cream p-0.5 shadow-sticker-sm">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-md font-mono font-semibold uppercase tracking-[0.12em] transition-colors ${
              size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'
            } ${active ? 'bg-ink text-pop-sun' : 'text-ink/70 hover:bg-ink/[0.07] hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Driver code chip with a team-colour bar. */
export function DriverChip({ code, color, title }: { code: string; color: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 overflow-hidden rounded-[4px] border border-ink/25 bg-white py-0.5 pl-0 pr-1.5 font-mono text-[11px] font-semibold text-ink">
      <span className="-my-0.5 h-5 w-[5px]" style={{ background: color }} />
      {code}
    </span>
  );
}

/** Monospace stat plate used on blueprint sheets: white sticker, ink keyline, corner ticks. */
export function StatPlate({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="relative rounded-md border-2 border-ink bg-white px-3 py-2 shadow-sticker-sm">
      <span className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-pop-pink" />
      <span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-pop-pink" />
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/70">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-bold tabular-nums" style={{ color: accent ?? '#170F33' }}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] text-ink/70">{sub}</div>}
    </div>
  );
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

export const fmtPct = (v: number | null | undefined, digits = 2) => (v == null ? '—' : `${v.toFixed(digits)}%`);

/**
 * A full-bleed colour sheet whose top edge bulges up into the sheet above in a wide
 * curve (a curved colour split). The curve is clipped to the viewport
 * width, so it never causes horizontal scroll. `bg` is a Tailwind background class.
 */
export function CurvedSheet({
  bg,
  depth = 64,
  className = '',
  children,
}: {
  bg: string;
  /** how far (px) the curve rises above the sheet top at its centre */
  depth?: number;
  className?: string;
  children: ReactNode;
}) {
  // phones get a shallower bulge so the curve reads as a gentle arc, not a dome
  const d = Math.round(useIsMobile() ? depth * 0.55 : depth);
  const r = Math.round(d / 0.255);
  return (
    <section className={`relative ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: -d }}>
        <div className={`pop-dots absolute inset-y-0 ${bg}`} style={{ left: '-25%', width: '150%', borderRadius: `50% 50% 0 0 / ${r}px ${r}px 0 0` }} />
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}
