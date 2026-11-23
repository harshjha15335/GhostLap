import { useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { useTicker } from '../lib/frame';
import { dirtyAirPenalty, downforcePct, fmtGap, tyreWear } from '../lib/raceMath';
import { TyreChip } from './TimingTower';

/** Focus-car telemetry: position, gaps, tyre life and the dirty-air downforce bar. */
export function FocusPanel() {
  useTicker(6);
  const { timeline, time, focusDriver } = useRaceLab.getState();
  useRaceLab((s) => s.focusDriver);
  const lookup = useDriverLookup();
  if (!timeline || focusDriver == null) return null;
  const states = timeline.statesAt(time);
  const s = states.find((x) => x.driverNumber === focusDriver);
  if (!s) return null;
  const d = lookup.driver(focusDriver);
  const team = d ? lookup.team(d.teamId) : undefined;
  const color = lookup.color(focusDriver);
  const ahead = states[s.position - 2];
  const gap = s.retired || s.finished || s.inPit ? Infinity : s.gapAhead;
  const df = downforcePct(gap);
  const pen = dirtyAirPenalty(gap);
  const wear = tyreWear(s.compound, s.tyreAge);
  const dirty = pen > 0.001;

  return (
    <section
      aria-label="Focus car telemetry"
      className="pointer-events-auto w-[200px] rounded-xl border-2 border-ink bg-cream-light p-2.5 text-ink shadow-sticker md:w-[260px]"
    >
      <div className="flex items-center gap-2">
        <span className="h-9 w-1.5 rounded-[2px] ring-1 ring-ink" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl leading-none text-ink-pink">P{s.position}</span>
            <span className="truncate font-display text-xl leading-none tracking-wide text-ink">{lookup.code(focusDriver)}</span>
          </div>
          <div className="truncate font-mono text-[10px] text-ink/70">
            {d?.fullName ?? `Car ${focusDriver}`} {team ? `· ${team.name}` : ''}
          </div>
        </div>
        <TyreChip compound={s.compound} size="md" />
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-1 rounded-md border-[1.5px] border-ink/20 bg-white px-1.5 py-1 font-mono text-[10px]">
        <div>
          <dt className="text-ink/70">AHEAD</dt>
          <dd className="truncate font-semibold text-ink">
            {s.position === 1 ? '—' : `${ahead ? lookup.code(ahead.driverNumber) : ''} ${fmtGap(s.gapAhead)}`}
          </dd>
        </div>
        <div>
          <dt className="text-ink/70">LEADER</dt>
          <dd className="font-semibold text-ink">{s.position === 1 ? 'LEADER' : fmtGap(s.gapToLeader)}</dd>
        </div>
        <div>
          <dt className="text-ink/70">TYRE</dt>
          <dd className="font-semibold text-ink">
            {s.tyreAge}L · {Math.round((1 - wear) * 100)}%
          </dd>
        </div>
      </dl>

      <div className="mt-2">
        <div className="mb-1 flex items-baseline justify-between font-mono text-[10px]">
          <span className={`font-semibold ${dirty ? 'text-ink-amber' : 'text-ink/70'}`}>DOWNFORCE{dirty ? ' · DIRTY AIR' : ''}</span>
          <span className={`font-bold tabular-nums ${dirty ? 'text-ink-amber' : 'text-ink-blue'}`}>
            {Math.round(df)}%{dirty ? ` · +${pen.toFixed(2)}s/lap` : ''}
          </span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-[4px] border-[1.5px] border-ink bg-white">
          <div
            className="absolute inset-y-0 left-0 transition-[width,background-color] duration-300"
            style={{
              width: `${df}%`,
              background: dirty ? 'linear-gradient(90deg,#E5650A,#FF9A3D)' : 'linear-gradient(90deg,#1A22C4,#2D3BFF)',
            }}
          />
          {/* 65 % floor marker = full dirty air */}
          <div className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: '65%' }} />
        </div>
      </div>
    </section>
  );
}
