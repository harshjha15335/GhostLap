import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { SeasonData } from '@/types';
import { StatPlate } from '@/components/ui/primitives';
import type { RosterEntry } from './roster';

/** Light season-stats sheet for one driver (all values from the season data). */
export default function DriverPanel({ entry, season, onClose }: { entry: RosterEntry; season: SeasonData; onClose: () => void }) {
  const { driver, team, standing } = entry;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const finishes = standing?.finishByRound ?? [];
  const classified = finishes.filter((f): f is number => f != null);
  const best = classified.length ? Math.min(...classified) : null;
  const avg = classified.length ? classified.reduce((a, b) => a + b, 0) / classified.length : null;
  const rounds = season.races.filter((r) => r.status !== 'cancelled');

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="driver-panel-title"
        onClick={(e) => e.stopPropagation()}
        className="theme-paper pop-dots relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border-2 border-ink bg-cream p-5 shadow-sticker-lg sm:rounded-2xl"
      >
        <span className="absolute inset-x-0 top-0 h-2 border-b-2 border-ink" style={{ background: team.color }} />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink bg-pop-pink text-ink shadow-sticker-sm"
        >
          <X size={16} />
        </button>
        <div className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
          #{driver.number} · {driver.code} · {team.name}
        </div>
        <h2 id="driver-panel-title" className="mt-1 font-display text-4xl uppercase leading-none tracking-wide text-ink">
          {driver.fullName}
        </h2>

        {standing ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatPlate label="Championship" value={`P${standing.position}`} accent="#C2005C" />
              <StatPlate label="Points" value={standing.points} />
              <StatPlate label="Wins" value={standing.wins} />
              <StatPlate label="Podiums" value={standing.podiums} />
              <StatPlate label="Best finish" value={best != null ? `P${best}` : '—'} />
              <StatPlate label="Avg finish" value={avg != null ? avg.toFixed(1) : '—'} sub={`${classified.length} classified`} />
            </div>
            <div className="mt-5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/70">Finish by round</div>
            <ol className="mt-1.5 flex flex-wrap gap-1">
              {rounds.map((r) => {
                const idx = season.races.indexOf(r);
                const f = finishes[idx] ?? null;
                const upcoming = r.status === 'upcoming';
                return (
                  <li
                    key={r.slug}
                    title={`R${r.round} ${r.name}: ${upcoming ? 'upcoming' : f != null ? `P${f}` : 'no classified result'}`}
                    className={`flex h-8 w-8 flex-col items-center justify-center rounded-[4px] border-[1.5px] border-ink font-mono text-[10px] font-bold tabular-nums ${
                      f === 1 ? 'bg-pop-sun' : f != null && f <= 3 ? 'bg-pop-sky' : f != null && f <= 10 ? 'bg-white' : 'bg-ink/[0.06] text-ink/60'
                    }`}
                  >
                    <span className="text-[7px] font-semibold text-ink/60">R{r.round}</span>
                    {upcoming ? '·' : f ?? '–'}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="mt-4 font-mono text-sm text-ink/70">No standings data for this driver.</p>
        )}
      </div>
    </div>
  );
}
