import type { RaceSummary } from '@/types';
import { useDriverLookup } from '@/store/seasonStore';
import { DriverChip } from '@/components/ui/primitives';

export const roundLabel = (r: RaceSummary) => (r.round > 0 ? `R${String(r.round).padStart(2, '0')}` : '—');
export const launchHref = (slug: string) => `/replay/${slug}?autoplay=1`;
/** the 3D inspector needs a race bundle, which only completed rounds have */
export const canInspect = (r: RaceSummary) => r.status === 'completed' && r.hasBundle;

export function DriverRow({ label, numbers }: { label: string; numbers: number[] }) {
  const { code, color, driver } = useDriverLookup();
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/70">{label}</span>
      <div className="flex flex-wrap gap-1">
        {numbers.length ? (
          numbers.map((n, i) => (
            <span key={n} className="flex items-center gap-0.5">
              <span className="font-mono text-[9px] text-ink/70">P{i + 1}</span>
              <DriverChip code={code(n)} color={color(n)} title={driver(n)?.fullName} />
            </span>
          ))
        ) : (
          <span className="font-mono text-[11px] text-ink/70">—</span>
        )}
      </div>
    </div>
  );
}

export function FlagCounts({ race }: { race: RaceSummary }) {
  const items = [
    { k: 'SC', v: race.safetyCars, c: '#FF7A00' },
    { k: 'VSC', v: race.virtualSafetyCars, c: '#FFD400' },
    { k: 'RED', v: race.redFlags, c: '#FF1E1E' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
      {items.map((i) => (
        <span
          key={i.k}
          className={`inline-flex items-center overflow-hidden rounded-[4px] border-[1.5px] ${i.v ? 'border-ink bg-white font-semibold text-ink' : 'border-ink/25 text-ink/70'}`}
        >
          <span className={`px-1 py-0.5 ${i.v ? 'border-r-[1.5px] border-ink' : ''}`} style={{ background: i.v ? i.c : undefined }}>
            {i.k}
          </span>
          <span className="px-1 py-0.5">×{i.v}</span>
        </span>
      ))}
      {race.winnerGapSeconds != null && (
        <span className="rounded-[4px] border-[1.5px] border-ink bg-white px-1.5 py-0.5 text-ink">
          Margin <span className="font-bold text-ink-green">+{race.winnerGapSeconds.toFixed(3)}s</span>
        </span>
      )}
    </div>
  );
}
