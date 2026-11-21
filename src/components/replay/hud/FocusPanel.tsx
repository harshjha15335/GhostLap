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
      className="pointer-events-auto w-[200px] rounded-md border border-line bg-panel/90 p-2.5 shadow-xl backdrop-blur md:w-[260px]"
    >
      <div className="flex items-center gap-2">
        <span className="h-8 w-1 rounded-sm" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl leading-none text-white">P{s.position}</span>
            <span className="truncate font-display text-lg leading-none tracking-wide" style={{ color }}>
              {lookup.code(focusDriver)}
            </span>
          </div>
          <div className="truncate font-mono text-[10px] text-white/45">
            {d?.fullName ?? `Car ${focusDriver}`} {team ? `· ${team.name}` : ''}
          </div>
        </div>
        <TyreChip compound={s.compound} size="md" />
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px]">
        <div>
          <dt className="text-white/40">AHEAD</dt>
          <dd className="truncate text-white/85">
            {s.position === 1 ? '—' : `${ahead ? lookup.code(ahead.driverNumber) : ''} ${fmtGap(s.gapAhead)}`}
          </dd>
        </div>
        <div>
          <dt className="text-white/40">LEADER</dt>
          <dd className="text-white/85">{s.position === 1 ? 'LEADER' : fmtGap(s.gapToLeader)}</dd>
        </div>
        <div>
          <dt className="text-white/40">TYRE</dt>
          <dd className="text-white/85">
            {s.tyreAge}L · {Math.round((1 - wear) * 100)}%
          </dd>
        </div>
      </dl>

      <div className="mt-2">
        <div className="mb-1 flex items-baseline justify-between font-mono text-[10px]">
          <span className={dirty ? 'text-amber' : 'text-white/45'}>DOWNFORCE{dirty ? ' · DIRTY AIR' : ''}</span>
          <span className={`tabular-nums ${dirty ? 'text-amber' : 'text-neon'}`}>
            {Math.round(df)}%{dirty ? ` · +${pen.toFixed(2)}s/lap` : ''}
          </span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-sm bg-asphalt ring-1 ring-line">
          <div
            className="absolute inset-y-0 left-0 transition-[width,background-color] duration-300"
            style={{
              width: `${df}%`,
              background: dirty ? 'linear-gradient(90deg,#FF7A00,#ffb066)' : 'linear-gradient(90deg,#9bbf00,#D4FF00)',
              boxShadow: dirty ? '0 0 10px #FF7A00' : '0 0 8px rgba(212,255,0,.5)',
            }}
          />
          {/* 65 % floor marker = full dirty air */}
          <div className="absolute inset-y-0 w-px bg-white/30" style={{ left: '65%' }} />
        </div>
      </div>
    </section>
  );
}
