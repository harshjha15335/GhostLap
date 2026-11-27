import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Flag, ShieldAlert } from 'lucide-react';
import { useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { buildRaceScene } from '../lib/raceScene';

/**
 * Short HUD toasts when, during forward playback, the race clock passes:
 *   - a staged retirement (crash / stopped car) — with the data's own message
 *   - a race-control collision note (CRASH events that "NOTED" an incident)
 *   - SC / VSC / red-flag deployments
 * Texts are quoted from the data; nothing is invented. A seek never fires toasts.
 */
interface Cue {
  t: number;
  kind: 'crash' | 'stop' | 'note' | 'SC' | 'VSC' | 'RED';
  title: string;
  text: string;
}
interface Toast extends Cue {
  id: number;
  born: number;
}

const STYLE: Record<Cue['kind'], string> = {
  crash: 'bg-[#FFD400] text-ink',
  stop: 'bg-cream-light text-ink',
  note: 'bg-cream-light text-ink',
  SC: 'bg-[#FFD400] text-ink',
  VSC: 'bg-amber text-ink',
  RED: 'bg-[#D7102A] text-white',
};

export function RaceToasts() {
  const bundle = useRaceLab((s) => s.bundle);
  const timeline = useRaceLab((s) => s.timeline);
  const lookup = useDriverLookup();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const last = useRef<number>(NaN);
  const seq = useRef(0);

  const cues = useMemo<Cue[]>(() => {
    if (!bundle || !timeline) return [];
    const scene = buildRaceScene(bundle, timeline);
    const out: Cue[] = [];
    scene.plans.forEach((p) => {
      if (!p || p.kind === 'garage') return;
      const code = lookup.code(p.driverNumber);
      out.push({
        t: p.tStop,
        kind: p.kind,
        title: p.kind === 'crash' ? `${code} · CRASH` : `${code} · STOPPED`,
        text: p.message ?? 'Retired from the race',
      });
    });
    for (const e of bundle.events) {
      const t = timeline.timeAtLap(e.lap);
      if (e.type === 'SC' || e.type === 'VSC' || e.type === 'RED') out.push({ t, kind: e.type, title: e.type === 'RED' ? 'RED FLAG' : e.type === 'SC' ? 'SAFETY CAR' : 'VIRTUAL SAFETY CAR', text: e.message });
      else if (e.type === 'CRASH' && /NOTED/i.test(e.message) && !/STEWARDS/i.test(e.message)) out.push({ t, kind: 'note', title: `LAP ${e.lap} · RACE CONTROL`, text: e.message });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [bundle, timeline, lookup]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const { time, playing } = useRaceLab.getState();
      const prev = last.current;
      last.current = time;
      const now = performance.now();
      setToasts((cur) => {
        let next = cur.filter((x) => now - x.born < 5200);
        if (playing && !Number.isNaN(prev) && time > prev && time - prev < 60) {
          for (const c of cues) if (c.t > prev && c.t <= time) next = [...next, { ...c, id: ++seq.current, born: now }];
        }
        if (next.length > 3) next = next.slice(next.length - 3);
        return next.length === cur.length && next.every((x, i) => x === cur[i]) ? cur : next;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [cues]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none flex w-[min(420px,calc(100vw-24px))] flex-col items-center gap-1.5" role="log" aria-live="polite">
      {toasts.map((x) => {
        const Icon = x.kind === 'crash' ? AlertTriangle : x.kind === 'RED' || x.kind === 'SC' || x.kind === 'VSC' ? Flag : ShieldAlert;
        return (
          <div key={x.id} className={`flex w-full items-start gap-2 rounded-lg border-2 border-ink px-2.5 py-1.5 shadow-sticker-sm ${STYLE[x.kind]}`}>
            <Icon size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-[13px] leading-tight tracking-wider">{x.title}</div>
              <div className="line-clamp-2 font-mono text-[10px] leading-snug opacity-80">{x.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
