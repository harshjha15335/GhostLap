import type { ReactNode } from 'react';
import type { RaceStatus } from '@/types';

/** Shared pit-wall UI primitives. */

export function SectionHeading({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-neon/80">{kicker}</div>
        <h2 className="mt-1 font-display text-3xl uppercase leading-none tracking-wide text-white sm:text-4xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const statusStyle: Record<RaceStatus, string> = {
  completed: 'border-neon/40 bg-neon/10 text-neon',
  cancelled: 'border-crimson/40 bg-crimson/10 text-crimson',
  upcoming: 'border-ghost/40 bg-ghost/10 text-ghost',
};
const statusLabel: Record<RaceStatus, string> = { completed: 'Completed', cancelled: 'Cancelled', upcoming: 'Upcoming' };

export function StatusBadge({ status }: { status: RaceStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${statusStyle[status]}`}>
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-line bg-asphalt/70 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-sm font-mono uppercase tracking-[0.14em] transition-colors ${
              size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'
            } ${active ? 'bg-neon text-asphalt' : 'text-white/60 hover:text-white'}`}
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
    <span title={title} className="inline-flex items-center gap-1 rounded-sm bg-white/5 py-0.5 pl-0 pr-1.5 font-mono text-[11px] font-semibold text-white/90">
      <span className="h-4 w-[3px] rounded-sm" style={{ background: color }} />
      {code}
    </span>
  );
}

/** Monospace stat plate used on blueprint sheets. */
export function StatPlate({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="relative border border-white/15 bg-asphalt/60 px-3 py-2">
      <span className="absolute -left-px -top-px h-2 w-2 border-l border-t border-ghost/80" />
      <span className="absolute -bottom-px -right-px h-2 w-2 border-b border-r border-ghost/80" />
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/45">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums" style={{ color: accent ?? '#fff' }}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] text-white/45">{sub}</div>}
    </div>
  );
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

export const fmtPct = (v: number | null | undefined, digits = 2) => (v == null ? '—' : `${v.toFixed(digits)}%`);
