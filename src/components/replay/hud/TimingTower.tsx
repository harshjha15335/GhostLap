import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CarState, Compound } from '@/types';
import TyreBadge from '@/components/ui/TyreBadge';
import { useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { useTicker } from '../lib/frame';
import { COMPOUND_SHORT, fmtGap, ghostProgress, timeAtProgress } from '../lib/raceMath';

export function TyreChip({ compound, age, size = 'sm' }: { compound: Compound; age?: number; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${compound.toLowerCase()} · ${COMPOUND_SHORT[compound]}`}>
      <TyreBadge compound={compound} size={size === 'md' ? 26 : 20} letter />
      {age !== undefined && <span className="w-4 font-mono text-[10px] text-white/45">{age}</span>}
    </span>
  );
}

interface Row {
  kind: 'car' | 'ghost';
  state: CarState;
  flag: 'PIT' | 'OUT' | 'DNF' | 'FIN' | null;
  lapped: number;
}

export function TimingTower() {
  useTicker(5);
  const { timeline, time, focusDriver, ghost, bundle } = useRaceLab.getState();
  const setFocus = useRaceLab((s) => s.setFocusDriver);
  useRaceLab((s) => s.focusDriver);
  useRaceLab((s) => s.ghost);
  const lookup = useDriverLookup();
  const [mode, setMode] = useState<'gap' | 'int'>('int');
  const [expanded, setExpanded] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);

  if (!timeline || !bundle) return null;
  const compact = window.innerWidth < 768;
  const states = timeline.statesAt(time);
  const leader = states[0];
  const pitSet = new Map(bundle.cars.map((c) => [c.driverNumber, new Set(c.pits.map((p) => p.lap))]));

  const rows: Row[] = states.map((s) => {
    const pits = pitSet.get(s.driverNumber);
    let flag: Row['flag'] = null;
    if (s.retired) flag = 'DNF';
    else if (s.inPit) flag = 'PIT';
    else if (pits?.has(s.lap - 1) && s.lapFraction < 0.3) flag = 'OUT';
    else if (s.finished) flag = 'FIN';
    return { kind: 'car', state: s, flag, lapped: Math.floor((leader?.progress ?? 0) - s.progress) };
  });

  // insert ghost row by progress
  let ghostRow: Row | null = null;
  if (ghost && leader) {
    const gp = ghostProgress(timeline, ghost, time);
    const leaderCum = timeline.cumulative.get(leader.driverNumber) ?? [];
    const done = time >= ghost.totalTime;
    const gapToLeader = done
      ? Math.max(0, ghost.totalTime - (leaderCum[leaderCum.length - 1] ?? ghost.totalTime))
      : Math.max(0, time - timeAtProgress(leaderCum, Math.min(gp.progress, leaderCum.length)));
    const realGhostCar = states.find((s) => s.driverNumber === ghost.scenario.driverNumber);
    let pos = done
      ? Math.min(states.length, Math.max(0, ghost.ghostFinishPosition - 1))
      : states.findIndex((s) => !s.retired && s.progress < gp.progress);
    if (pos < 0) pos = states.filter((s) => !s.retired).length;
    const stopLaps = new Set(ghost.scenario.stops.map((s) => s.lap));
    let compound: Compound = realGhostCar?.compound ?? 'MEDIUM';
    let age = realGhostCar?.tyreAge ?? 0;
    if (gp.lap >= ghost.scenario.fromLap) {
      const prior = [...ghost.scenario.stops].filter((s) => s.lap < gp.lap).sort((a, b) => b.lap - a.lap)[0];
      if (prior) {
        compound = prior.compound;
        age = gp.lap - prior.lap - 1;
      }
    }
    ghostRow = {
      kind: 'ghost',
      state: {
        ...(realGhostCar ?? leader),
        driverNumber: ghost.scenario.driverNumber,
        lap: gp.lap,
        progress: gp.progress,
        position: pos + 1,
        gapToLeader,
        gapAhead: NaN,
        compound,
        tyreAge: age,
        inPit: stopLaps.has(gp.lap) && gp.lapFraction > 0.93,
        retired: false,
        finished: done,
      },
      flag: stopLaps.has(gp.lap) && gp.lapFraction > 0.93 ? 'PIT' : done ? 'FIN' : null,
      lapped: 0,
    };
    rows.splice(pos, 0, ghostRow);
  }

  const visible = expanded
    ? rows
    : rows.filter((r, i) => i < 5 || r.kind === 'ghost' || r.state.driverNumber === focusDriver);

  return (
    <section
      aria-label="Live timing"
      className="pointer-events-auto w-[178px] select-none overflow-hidden rounded-md border border-line bg-panel/85 shadow-xl backdrop-blur md:w-[248px]"
    >
      <header className="flex items-center justify-between border-b border-line px-2 py-1.5">
        <span className="font-display text-[13px] tracking-wider text-white">TIMING</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode(mode === 'gap' ? 'int' : 'gap')}
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-white/70 hover:text-neon"
            title="Toggle gap to leader / interval"
          >
            {mode === 'gap' ? 'GAP' : 'INT'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="rounded border border-line p-0.5 text-white/70 hover:text-neon"
            aria-label={expanded ? 'Collapse timing tower' : 'Expand timing tower'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </header>
      <ol className="scrollbar-thin max-h-[calc(100dvh-280px)] overflow-y-auto md:max-h-[calc(100dvh-300px)]">
        {visible.map((r, i) => {
          const s = r.state;
          const isGhost = r.kind === 'ghost';
          const isFocus = !isGhost && s.driverNumber === focusDriver;
          const color = lookup.color(s.driverNumber);
          const prev = visible[i - 1];
          const gapStr = r.flag === 'DNF'
            ? 'DNF'
            : s.position === 1 && !isGhost
              ? compact ? 'LEAD' : 'LEADER'
              : r.lapped >= 1 && mode === 'gap'
                ? `+${r.lapped} LAP`
                : mode === 'gap' || isGhost
                  ? fmtGap(s.gapToLeader, compact)
                  : fmtGap(s.gapAhead, compact);
          const skipped = !expanded && prev && rows.indexOf(prev) !== rows.indexOf(r) - 1;
          return (
            <li key={isGhost ? 'ghost' : s.driverNumber}>
              {skipped && <div className="h-px bg-line/70" />}
              <button
                type="button"
                onClick={() => !isGhost && setFocus(s.driverNumber)}
                className={`flex h-[23px] w-full items-center gap-1.5 px-1.5 text-left font-mono text-[11px] leading-none transition-colors ${
                  isGhost
                    ? 'bg-ghost/10 text-ghost'
                    : isFocus
                      ? 'bg-neon/15 text-white'
                      : 'text-white/85 hover:bg-white/5'
                } ${r.flag === 'DNF' ? 'opacity-45' : ''}`}
              >
                <span className={`w-5 text-right tabular-nums ${isFocus ? 'text-neon' : 'text-white/55'}`}>
                  {isGhost ? '◆' : s.retired ? '–' : s.position}
                </span>
                <span className="h-3.5 w-[3px] rounded-sm" style={{ background: isGhost ? '#00F5D4' : color }} />
                <span className="w-[30px] font-semibold tracking-wide">{lookup.code(s.driverNumber)}</span>
                <span className={`flex-1 truncate text-right tabular-nums ${isGhost ? 'text-ghost' : 'text-white/60'}`}>
                  {gapStr}
                </span>
                <span className="hidden md:inline-flex">
                  <TyreChip compound={s.compound} age={s.tyreAge} />
                </span>
                <span className="md:hidden">
                  <TyreChip compound={s.compound} />
                </span>
                <span className="w-7 text-center">
                  {r.flag && r.flag !== 'DNF' && (
                    <span
                      className={`rounded-[3px] px-1 py-[2px] text-[8.5px] font-bold ${
                        r.flag === 'PIT'
                          ? 'bg-white text-asphalt'
                          : r.flag === 'OUT'
                            ? 'bg-amber text-asphalt'
                            : 'bg-white/10 text-white/70'
                      }`}
                    >
                      {r.flag}
                    </span>
                  )}
                  {isGhost && !r.flag && <span className="text-[8.5px] font-bold">GST</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
