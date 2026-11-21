import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Upgrade } from '@/types';
import { upgradeTitle } from './seasonStats';

/** Lightweight SVG line charts (no chart lib). One y-axis, thin 2px lines, crosshair tooltip. */

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Series {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

export function LineChart({
  title,
  subtitle,
  xLabels,
  series,
  yFormat = (v) => String(Math.round(v)),
  invert = false,
  height = 220,
  yMin,
  markers,
  footnote,
}: {
  title: string;
  subtitle?: string;
  xLabels: string[];
  series: Series[];
  yFormat?: (v: number) => string;
  /** true = smaller is better, draw 0 at the top */
  invert?: boolean;
  height?: number;
  yMin?: number;
  /** x indices to mark with a vertical tick (e.g. upgrade rounds) */
  markers?: { index: number; label: string }[];
  footnote?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 40, r: 54, t: 12, b: 26 };
  const W = width;
  const H = height;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const lo = yMin ?? Math.min(0, ...all);
  const hiRaw = all.length ? Math.max(...all) : 1;
  // nice upper bound
  const step = niceStep((hiRaw - lo) / 4 || 1);
  const hi = Math.ceil(hiRaw / step) * step || step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const n = xLabels.length;
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => (invert ? m.t + ((v - lo) / (hi - lo)) * ih : m.t + ih - ((v - lo) / (hi - lo)) * ih);

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastIdx = (vals: (number | null)[]) => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i;
    return -1;
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - m.l) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 44)));

  return (
    <figure className="min-w-0 rounded border border-line bg-panel p-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">{title}</div>
          {subtitle && <div className="font-mono text-[10px] text-white/40">{subtitle}</div>}
        </div>
        {series.length > 1 && (
          <div className="flex flex-wrap gap-3 font-mono text-[10px] text-white/60">
            {series.map((s) => (
              <span key={s.id} className="flex items-center gap-1.5">
                <svg width="16" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
                </svg>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </figcaption>
      <div ref={ref} className="relative">
        <svg width={W} height={H} className="block max-w-full touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="#232A36" strokeWidth={1} />
              <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-white/40 font-mono text-[9px]">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {xLabels.map((l, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-white/40 font-mono text-[9px]">
                {l}
              </text>
            ) : null,
          )}
          {markers?.map((mk) => (
            <g key={mk.index}>
              <line x1={x(mk.index)} x2={x(mk.index)} y1={m.t} y2={m.t + ih} stroke="#00F5D4" strokeOpacity={0.35} strokeDasharray="2 3" />
              <path d={`M${x(mk.index) - 4} ${m.t} L${x(mk.index) + 4} ${m.t} L${x(mk.index)} ${m.t + 6}Z`} fill="#00F5D4" />
            </g>
          ))}
          {series.map((s) => (
            <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
          ))}
          {/* direct end labels */}
          {series.map((s) => {
            const i = lastIdx(s.values);
            if (i < 0) return null;
            return (
              <g key={`end-${s.id}`}>
                <circle cx={x(i)} cy={y(s.values[i] as number)} r={3.5} fill={s.color} stroke="#10151F" strokeWidth={2} />
                <text x={x(i) + 7} y={y(s.values[i] as number)} dy="0.32em" className="fill-white/80 font-mono text-[9px]">
                  {series.length > 1 ? `${s.id} ` : ''}
                  {yFormat(s.values[i] as number)}
                </text>
              </g>
            );
          })}
          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="#ffffff" strokeOpacity={0.35} />
              {series.map((s) =>
                s.values[hover] != null ? (
                  <circle key={s.id} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={s.color} stroke="#10151F" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-sm border border-white/15 bg-asphalt/95 px-2 py-1.5 font-mono text-[10px] shadow-lg"
            style={{ left: Math.min(Math.max(0, x(hover) + 10), W - 150) }}
          >
            <div className="mb-0.5 text-white/50">{xLabels[hover]}</div>
            {series.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 text-white/85">
                <span className="h-[2px] w-3" style={{ background: s.color }} />
                {s.label}: <span className="tabular-nums">{s.values[hover] == null ? 'no data' : yFormat(s.values[hover] as number)}</span>
              </div>
            ))}
            {markers?.filter((mk) => mk.index === hover).map((mk) => (
              <div key={mk.label} className="mt-0.5 text-ghost">{mk.label}</div>
            ))}
          </div>
        )}
      </div>
      {footnote && <div className="mt-1 font-mono text-[9px] leading-relaxed text-white/35">{footnote}</div>}
    </figure>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Before → after fuel-corrected race-pace badges for upgrade markers. */
export function UpgradeBadges({ upgrades, teamName, onPick, activeRound }: { upgrades: Upgrade[]; teamName: string; onPick?: (round: number) => void; activeRound?: number }) {
  if (!upgrades.length)
    return (
      <div className="rounded border border-line bg-panel p-3 font-mono text-[11px] text-white/45">
        No pace step detected for {teamName} — no significant step in fuel-corrected race pace between rounds.
      </div>
    );
  return (
    <div className="rounded border border-line bg-panel p-3">
      <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">Upgrade markers · {teamName}</div>
      <div className="flex flex-wrap gap-2">
        {upgrades.map((u) => {
          const better = (u.paceDelta ?? 0) < 0;
          return (
            <button
              key={`${u.round}-${u.title}`}
              type="button"
              onClick={() => onPick?.(u.round)}
              className={`rounded-sm border px-2.5 py-1.5 text-left font-mono transition-colors ${
                activeRound === u.round ? 'border-ghost bg-ghost/10' : 'border-white/15 bg-asphalt/50 hover:border-white/35'
              }`}
            >
              <div className="text-[9px] uppercase tracking-widest text-white/45">
                R{u.round} · {upgradeTitle(u)}
                {u.source === 'detected' ? ' · area unknown' : ` · ${u.area}`}
              </div>
              <div className="text-[12px] tabular-nums text-white">
                {u.paceBefore?.toFixed(2) ?? '—'}% <span className="text-white/40">→</span> {u.paceAfter?.toFixed(2) ?? '—'}%
                {u.paceDelta != null && (
                  <span className={`ml-2 text-[11px] ${better ? 'text-ghost' : 'text-amber'}`}>
                    {better ? '▼' : '▲'} {Math.abs(u.paceDelta).toFixed(2)} pp
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 font-mono text-[9px] leading-relaxed text-white/35">
        Gap to fastest, fuel-corrected race pace, mean of up to 3 rounds before vs after. Detected markers are statistical steps in real lap data;
        OpenF1 has no upgrade feed, so the upgraded area is unknown.
      </div>
    </div>
  );
}
