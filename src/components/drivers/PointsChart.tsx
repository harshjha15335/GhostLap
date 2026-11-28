import { useEffect, useRef, useState } from 'react';
import type { RaceSummary } from '@/types';

export interface PointsSeries {
  label: string;
  /** cumulative points per completed round (null = no value that round) */
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}

const H = 220;
const PAD = { l: 34, r: 64, t: 12, b: 26 };

/** Cumulative championship points by round, with a hover crosshair + tooltip. */
export default function PointsChart({ rounds, series, onDark = false }: { rounds: RaceSummary[]; series: PointsSeries[]; onDark?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  // the viewBox follows the rendered width, so labels stay at true pixel size on phones
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = rounds.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v != null)));
  const step = max > 300 ? 100 : max > 120 ? 50 : max > 40 ? 20 : max > 12 ? 5 : 2;
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  const ink = onDark ? '#FFF7EE' : '#170F33';
  const grid = onDark ? 'rgba(255,247,238,0.22)' : 'rgba(23,15,51,0.12)';
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastIdx = (vals: (number | null)[]) => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i;
    return -1;
  };

  return (
    <div ref={boxRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Cumulative points by round: ${series.map((s) => `${s.label} ${s.values[lastIdx(s.values)] ?? 0}`).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={grid} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fontFamily="ui-monospace, monospace" fill={ink} opacity={0.7}>
              {t}
            </text>
          </g>
        ))}
        {rounds.map((r, i) =>
          i % Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - PAD.l - PAD.r) / 44)))) === 0 || i === n - 1 ? (
            <text key={r.slug} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill={ink} opacity={0.7}>
              R{r.round}
            </text>
          ) : null,
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke={ink} strokeOpacity={0.35} strokeWidth={1} />}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.dashed ? 2 : 2.5} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const i = lastIdx(s.values);
          if (i < 0) return null;
          return (
            <g key={`${s.label}-end`}>
              <circle cx={x(i)} cy={y(s.values[i]!)} r={4} fill={s.color} stroke={onDark ? '#170F33' : '#FFF7EE'} strokeWidth={2} />
              <text x={x(i) + 8} y={y(s.values[i]!) + 3.5} fontSize={11} fontWeight={700} fontFamily="ui-monospace, monospace" fill={ink}>
                {s.label}
              </text>
            </g>
          );
        })}
        {hover != null &&
          series.map((s) =>
            s.values[hover] != null ? <circle key={`${s.label}-h`} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke={ink} strokeWidth={1.5} /> : null,
          )}
        {rounds.map((r, i) => (
          <rect
            key={`hit-${r.slug}`}
            x={x(i) - (W - PAD.l - PAD.r) / Math.max(1, n - 1) / 2}
            y={0}
            width={(W - PAD.l - PAD.r) / Math.max(1, n - 1)}
            height={H}
            fill="transparent"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[11px] text-ink shadow-sticker-sm"
          style={{ left: `${Math.min(80, Math.max(20, (x(hover) / W) * 100))}%` }}
        >
          <div className="font-semibold">
            R{rounds[hover].round} {rounds[hover].circuitName}
          </div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 tabular-nums">
              <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
              {s.label}: {s.values[hover] ?? '—'} pts
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px]" style={{ color: ink }}>
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
