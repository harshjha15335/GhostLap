import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import type { RaceEvent, RaceEventType } from '@/types';
import { PLAYBACK_SPEEDS, useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { useTicker } from '../lib/frame';
import { fmtRaceClock } from '../lib/raceMath';

const MAJOR: RaceEventType[] = ['CRASH', 'DNF', 'PENALTY', 'FASTEST_LAP', 'SC', 'VSC', 'RED'];
const PIN_STYLE: Record<RaceEventType, { color: string; glyph: string; label: string }> = {
  SC: { color: '#FFD400', glyph: 'SC', label: 'Safety Car' },
  VSC: { color: '#FF7A00', glyph: 'V', label: 'Virtual Safety Car' },
  RED: { color: '#FF1E1E', glyph: 'R', label: 'Red Flag' },
  CRASH: { color: '#FF1E1E', glyph: '!', label: 'Crash' },
  DNF: { color: '#9aa3ad', glyph: '×', label: 'Retirement' },
  PENALTY: { color: '#FF7A00', glyph: 'P', label: 'Penalty' },
  FASTEST_LAP: { color: '#B44CFF', glyph: '⏱', label: 'Fastest Lap' },
  PIT: { color: '#EDEFF2', glyph: '', label: 'Pit Stops' },
  OVERTAKE: { color: '#D4FF00', glyph: '', label: 'Overtakes' },
};
// status bands sit on the racing-green timeline strip
const BAND: Record<string, string> = { SC: 'rgba(255,212,0,.42)', VSC: 'rgba(255,122,0,.42)', RED: 'rgba(255,30,30,.5)' };

interface Popover {
  lap: number;
  type: RaceEventType;
  items: RaceEvent[];
  x: number;
}

function LapReadout() {
  useTicker(4);
  const { timeline, time } = useRaceLab.getState();
  if (!timeline) return null;
  const lap = timeline.leaderLapAt(time);
  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span className="font-display text-xl leading-none tracking-wide text-ink md:text-2xl">
        LAP <span className="text-paper-green">{lap}</span>
        <span className="text-ink/60">/{timeline.totalLaps}</span>
      </span>
      <span className="hidden text-[11px] tabular-nums text-ink/70 sm:inline">{fmtRaceClock(time)}</span>
    </div>
  );
}

export function Scrubber() {
  const timeline = useRaceLab((s) => s.timeline);
  const bundle = useRaceLab((s) => s.bundle);
  const playing = useRaceLab((s) => s.playing);
  const speed = useRaceLab((s) => s.speed);
  const togglePlay = useRaceLab((s) => s.togglePlay);
  const setSpeed = useRaceLab((s) => s.setSpeed);
  const lookup = useDriverLookup();
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ active: boolean; wasPlaying: boolean }>({ active: false, wasPlaying: false });
  const [pop, setPop] = useState<Popover | null>(null);

  const dur = timeline?.duration ?? 1;
  const xOf = (t: number) => Math.max(0, Math.min(100, (t / dur) * 100));

  const model = useMemo(() => {
    if (!timeline || !bundle) return null;
    const lapX = (lap: number) => xOf(timeline.timeAtLap(lap));
    const bands = bundle.trackStatus.map((w) => ({
      ...w,
      x0: lapX(w.startLap),
      x1: w.endLap >= bundle.totalLaps ? xOf(timeline.duration - 5) : lapX(w.endLap + 1),
    }));
    const groups = new Map<string, Popover>();
    for (const e of bundle.events) {
      const key = `${e.lap}:${e.type}`;
      const g = groups.get(key) ?? { lap: e.lap, type: e.type, items: [], x: lapX(e.lap) + 0.5 / bundle.totalLaps * 100 };
      g.items.push(e);
      groups.set(key, g);
    }
    const all = [...groups.values()];
    const major = all.filter((g) => MAJOR.includes(g.type));
    // stack major pins that share a lap
    const stack = new Map<number, number>();
    const majorPlaced = major.map((g) => {
      const n = stack.get(g.lap) ?? 0;
      stack.set(g.lap, n + 1);
      return { ...g, row: n };
    });
    const ticks = all.filter((g) => g.type === 'PIT' || g.type === 'OVERTAKE');
    const labels: number[] = [];
    const step = bundle.totalLaps > 60 ? 10 : 5;
    for (let l = step; l < bundle.totalLaps; l += step) labels.push(l);
    return { bands, majorPlaced, ticks, labels, lapX };
  }, [timeline, bundle]);

  // playhead at display rate, no React renders
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const { time, timeline: tl } = useRaceLab.getState();
      if (tl) {
        const x = Math.max(0, Math.min(100, (time / tl.duration) * 100));
        if (headRef.current) headRef.current.style.left = `${x}%`;
        if (fillRef.current) fillRef.current.style.width = `${x}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!pop) return;
    const id = window.setTimeout(() => setPop(null), 7000);
    return () => window.clearTimeout(id);
  }, [pop]);

  const seekToClientX = (cx: number) => {
    const el = trackRef.current;
    const tl = useRaceLab.getState().timeline;
    if (!el || !tl) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (cx - r.left) / r.width));
    useRaceLab.getState().setTime(f * tl.duration);
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { active: true, wasPlaying: useRaceLab.getState().playing };
    useRaceLab.getState().pause();
    seekToClientX(e.clientX);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current.active) seekToClientX(e.clientX);
  };
  const onUp = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    const s = useRaceLab.getState();
    if (drag.current.wasPlaying && s.timeline && s.time < s.timeline.duration) s.play();
  };

  const openPin = (g: Popover) => {
    const s = useRaceLab.getState();
    s.seekLap(g.lap);
    const dn = g.items.find((i) => i.driverNumber != null)?.driverNumber;
    if (dn != null && g.items.length === 1) s.setFocusDriver(dn);
    setPop(g);
  };

  const stepLap = (d: number) => {
    const s = useRaceLab.getState();
    if (!s.timeline) return;
    s.seekLap(Math.max(1, Math.min(s.timeline.totalLaps, s.timeline.leaderLapAt(s.time) + d)));
  };

  if (!timeline || !bundle || !model) return null;

  const describe = (e: RaceEvent) => {
    const a = e.driverNumber != null ? lookup.code(e.driverNumber) : '';
    const b = e.otherDriverNumber != null ? lookup.code(e.otherDriverNumber) : '';
    if (e.type === 'OVERTAKE' && a && b) return `${a} passes ${b} · ${e.message.replace(/^On-track pass for /, '')}`;
    return a && !e.message.includes(`(${a})`) ? `${a} · ${e.message}` : e.message;
  };

  return (
    <section aria-label="Race timeline" className="pointer-events-auto relative rounded-xl border-2 border-ink bg-cream-light px-3 pb-2.5 pt-2 text-ink shadow-sticker">
      {/* transport */}
      <div className="mb-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => stepLap(-1)}
          className="hidden h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-ink/[0.07] sm:flex"
          aria-label="Previous lap"
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-neon text-ink shadow-sticker-sm transition-transform active:scale-95"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => stepLap(1)}
          className="hidden h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-ink/[0.07] sm:flex"
          aria-label="Next lap"
        >
          <SkipForward size={16} />
        </button>
        <div className="ml-1">
          <LapReadout />
        </div>
        <div className="ml-auto flex items-center">
          {/* desktop: segmented; mobile: cycle */}
          <div className="hidden overflow-hidden rounded-md border-2 border-ink bg-white sm:flex" role="group" aria-label="Playback speed">
            {PLAYBACK_SPEEDS.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSpeed(sp)}
                className={`px-2 py-1 font-mono text-[11px] font-semibold ${sp === speed ? 'bg-ink text-neon' : 'text-ink/75 hover:bg-ink/[0.07] hover:text-ink'}`}
              >
                {sp}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const i = PLAYBACK_SPEEDS.indexOf(speed as (typeof PLAYBACK_SPEEDS)[number]);
              setSpeed(PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length]);
            }}
            className="h-9 min-w-[52px] rounded-md border-2 border-ink bg-ink px-2 font-mono text-xs font-bold text-neon sm:hidden"
            aria-label="Change playback speed"
          >
            {speed}×
          </button>
        </div>
      </div>

      {/* timeline track */}
      <div className="relative pt-4">
        {/* major pins */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-4">
          {model.majorPlaced.map((g) => {
            const st = PIN_STYLE[g.type];
            return (
              <button
                key={`${g.lap}:${g.type}`}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => openPin(g)}
                className="pointer-events-auto absolute flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-[3px] border border-ink px-[3px] font-mono text-[9px] font-bold leading-none text-ink transition-transform hover:z-10 hover:scale-125"
                style={{ left: `${g.x}%`, top: -g.row * 9, background: st.color }}
                title={`Lap ${g.lap} · ${st.label}${g.items.length > 1 ? ` ×${g.items.length}` : ''}`}
                aria-label={`Lap ${g.lap} ${st.label}`}
              >
                {st.glyph}
              </button>
            );
          })}
        </div>

        <div
          ref={trackRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="relative h-10 cursor-pointer touch-none rounded-md border-2 border-ink bg-paper-green md:h-9"
          role="slider"
          aria-label="Race position"
          aria-valuemin={1}
          aria-valuemax={timeline.totalLaps}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') stepLap(1);
            if (e.key === 'ArrowLeft') stepLap(-1);
          }}
        >
          {/* status bands */}
          {model.bands.map((b, i) => (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                openPin({
                  lap: b.startLap,
                  type: b.type,
                  items: bundle.events.filter((e) => e.type === b.type && e.lap === b.startLap),
                  x: b.x0,
                })
              }
              className="absolute inset-y-0"
              style={{ left: `${b.x0}%`, width: `${Math.max(0.6, b.x1 - b.x0)}%`, background: BAND[b.type] }}
              aria-label={`${b.type} laps ${b.startLap}–${b.endLap}`}
            />
          ))}
          <div ref={fillRef} className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-neon/15" />
          {/* lap grid */}
          {model.labels.map((l) => (
            <div key={l} className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.12]" style={{ left: `${model.lapX(l)}%` }}>
              <span className="absolute bottom-0.5 left-1 font-mono text-[9px] text-cream/70">{l}</span>
            </div>
          ))}
          {/* minor ticks: pits (bottom), overtakes (top) */}
          {model.ticks.map((g) => {
            const h = Math.min(12, 3 + g.items.length * 1.6);
            const isPit = g.type === 'PIT';
            return (
              <button
                key={`${g.lap}:${g.type}`}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => openPin(g)}
                className="absolute w-[5px] -translate-x-1/2 opacity-80 hover:opacity-100"
                style={{ left: `${g.x}%`, height: h, [isPit ? 'bottom' : 'top']: 2, background: PIN_STYLE[g.type].color, borderRadius: 1 }}
                title={`Lap ${g.lap} · ${g.items.length} ${PIN_STYLE[g.type].label.toLowerCase()}`}
                aria-label={`Lap ${g.lap} ${PIN_STYLE[g.type].label}`}
              />
            );
          })}
          {/* playhead */}
          <div ref={headRef} className="pointer-events-none absolute -top-1 bottom-[-4px] w-0">
            <div className="absolute -left-[2px] top-0 h-full w-1 border-x border-ink bg-neon" />
            <div className="absolute -left-[8px] -top-1.5 h-4 w-4 rotate-45 rounded-[3px] border-2 border-ink bg-neon" />
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="mt-1.5 hidden flex-wrap gap-x-3 gap-y-1 font-mono text-[9.5px] text-ink/70 md:flex">
        <span><i className="mr-1 inline-block h-2 w-2 border border-ink bg-[#D4FF00]" />overtakes</span>
        <span><i className="mr-1 inline-block h-2 w-2 border border-ink bg-[#EDEFF2]" />pit stops</span>
        <span><i className="mr-1 inline-block h-2 w-2 border border-ink bg-[#FFD400]" />SC</span>
        <span><i className="mr-1 inline-block h-2 w-2 border border-ink bg-[#FF7A00]" />VSC / penalty</span>
        <span><i className="mr-1 inline-block h-2 w-2 border border-ink bg-[#B44CFF]" />fastest lap</span>
        <span className="ml-auto">drag to scrub · click a pin to jump · space play/pause</span>
      </div>

      {pop && (
        <div
          className="absolute bottom-full z-30 mb-2 w-[min(320px,calc(100vw-32px))] rounded-xl border-2 border-ink bg-cream-light p-2.5 text-ink shadow-sticker"
          style={{ left: `clamp(0px, calc(${pop.x}% - 160px), calc(100% - min(320px, calc(100vw - 32px))))` }}
          role="status"
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-[3px] border border-ink px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink" style={{ background: PIN_STYLE[pop.type].color }}>
              {PIN_STYLE[pop.type].label.toUpperCase()}
            </span>
            <span className="font-mono text-[11px] font-semibold text-ink/70">LAP {pop.lap}</span>
            <button type="button" onClick={() => setPop(null)} className="ml-auto rounded text-ink/70 hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <ul className="scrollbar-thin max-h-32 space-y-0.5 overflow-y-auto">
            {pop.items.map((e, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full rounded px-0.5 text-left text-[12px] leading-snug text-ink hover:bg-neon"
                  onClick={() => e.driverNumber != null && useRaceLab.getState().setFocusDriver(e.driverNumber)}
                >
                  {describe(e)}
                </button>
              </li>
            ))}
            {pop.items.length === 0 && <li className="text-[12px] text-ink/70">Track status change</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
