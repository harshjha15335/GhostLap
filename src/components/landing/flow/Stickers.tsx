import type { CSSProperties, ReactNode } from 'react';
import type { LandingStats } from '../stats';
import type { FeatureRace } from './featureRace';
import { C } from './theme';

/* ----------------------------------------------------------------------------
 * "Photo sticker" cards: rounded squircles with a thick offset edge and a strip
 * of tape, built entirely from DOM/SVG with real app data.
 * ------------------------------------------------------------------------- */

export function Sticker({
  bg,
  edge,
  tilt = 0,
  tape = 'top',
  tapeDark = false,
  className = '',
  style,
  children,
}: {
  bg: string;
  /** colour of the solid offset edge */
  edge?: string;
  tilt?: number;
  tape?: 'top' | 'corner' | 'none';
  tapeDark?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`relative ${className}`} style={{ transform: `rotate(${tilt}deg)`, ...style }}>
      <div
        className="fl-squircle relative h-full w-full overflow-hidden"
        style={{ background: bg, boxShadow: `-0.06em 0.1em 0 ${edge ?? 'rgba(0,0,0,0.28)'}, 0 1.2em 2em rgba(0,0,0,0.18)` }}
      >
        {children}
      </div>
      {tape === 'top' && <span className={`fl-tape ${tapeDark ? 'dark' : ''}`} style={{ left: '22%', top: '-7%', width: '56%', height: '15%', transform: 'rotate(2deg)' }} />}
      {tape === 'corner' && <span className={`fl-tape ${tapeDark ? 'dark' : ''}`} style={{ right: '-8%', top: '4%', width: '40%', height: '13%', transform: 'rotate(38deg)' }} />}
    </div>
  );
}

const mono = 'font-mono uppercase tracking-[0.14em]';

/** Real circuit outline (orange section, left). */
export function TrackSticker({ race, reduced }: { race: FeatureRace | null; reduced: boolean }) {
  return (
    <Sticker bg={C.violet} edge="#3d22c9" tilt={-7} className="h-full w-full">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_60%)]" />
      <div className={`absolute left-[10%] top-[9%] ${mono} text-[0.62em] text-white/80`}>
        {race ? `R${race.round} · ${race.circuitName}` : 'Loading circuit…'}
      </div>
      <svg viewBox="-6 -6 112 112" className="absolute inset-[14%_8%_12%_8%] h-[74%] w-[84%]" aria-hidden>
        {race && (
          <>
            <path d={race.outline} fill="none" stroke="#080B10" strokeWidth="9" strokeLinejoin="round" opacity="0.45" transform="translate(-1.5 2.5)" />
            <path d={race.outline} fill="none" stroke={C.neon} strokeWidth="6" strokeLinejoin="round" />
            <path d={race.outline} fill="none" stroke="#080B10" strokeWidth="0.8" strokeDasharray="2 3" />
            <circle cx={race.start[0]} cy={race.start[1]} r="4" fill="#fff" stroke="#080B10" strokeWidth="1.5" />
            {!reduced && (
              <circle r="3.6" fill={C.ghost} stroke="#080B10" strokeWidth="1">
                <animateMotion dur="7s" repeatCount="indefinite" path={race.outline} />
              </circle>
            )}
          </>
        )}
      </svg>
      <div className={`absolute bottom-[8%] right-[9%] rounded-full bg-[#080B10] px-[0.7em] py-[0.25em] ${mono} text-[0.55em] text-neon`}>
        {race?.laps ? `${race.laps} laps` : 'real trace'}
      </div>
    </Sticker>
  );
}

/** Mini timing tower: real top-5 finishers of the featured race. */
export function TowerSticker({ race }: { race: FeatureRace | null }) {
  return (
    <Sticker bg={C.asphalt} edge="#000" tilt={9} tapeDark className="h-full w-full">
      <div className="absolute inset-0 flex flex-col px-[9%] pb-[9%] pt-[13%]">
        <div className={`flex items-center justify-between ${mono} text-[0.55em] text-white/55`}>
          <span>Classification</span>
          <span className="text-neon">FLAG</span>
        </div>
        <div className="mt-[6%] flex flex-1 flex-col justify-between">
          {(race?.tower.length ? race.tower : Array.from({ length: 5 }, (_, i) => ({ pos: i + 1, code: '···', color: '#3a404a', gap: '' }))).map((r) => (
            <div key={r.pos} className="flex items-center gap-[0.5em] border-t border-white/10 pt-[3%] font-mono text-[0.7em] font-semibold text-white">
              <span className="w-[1.4em] text-white/45">{r.pos}</span>
              <span className="h-[1.1em] w-[0.28em] rounded-full" style={{ background: r.color }} />
              <span className="tracking-[0.08em]">{r.code}</span>
              <span className={`ml-auto text-[0.82em] ${r.gap === 'WIN' ? 'text-neon' : 'text-white/60'}`}>{r.gap}</span>
            </div>
          ))}
        </div>
        <div className={`mt-[5%] ${mono} text-[0.5em] text-white/40`}>{race ? race.name : 'no data yet'}</div>
      </div>
    </Sticker>
  );
}

/** Perspective track card for TO REPLAY. */
export function Track3DSticker({ race, reduced }: { race: FeatureRace | null; reduced: boolean }) {
  return (
    <Sticker bg={C.lilac} edge="#7d66e0" tilt={-4} className="h-full w-full">
      <div className="absolute inset-0 bg-[linear-gradient(160deg,#cbbcff_0%,#8f76ff_100%)]" />
      <div className="absolute inset-0" style={{ perspective: '600px' }}>
        <svg
          viewBox="-6 -6 112 112"
          className="absolute left-[8%] top-[18%] h-[84%] w-[84%]"
          style={{ transform: 'rotateX(58deg) rotateZ(-24deg)', transformOrigin: '50% 60%' }}
          aria-hidden
        >
          {race && (
            <>
              <path d={race.outline} fill="none" stroke="#2b1a7a" strokeWidth="14" strokeLinejoin="round" transform="translate(0 5)" opacity="0.55" />
              <path d={race.outline} fill="none" stroke="#14161a" strokeWidth="11" strokeLinejoin="round" />
              <path d={race.outline} fill="none" stroke="#f2f2f2" strokeWidth="0.9" strokeDasharray="3 3" />
              {!reduced && (
                <>
                  <circle r="5" fill={C.ghost}>
                    <animateMotion dur="6s" repeatCount="indefinite" path={race.outline} />
                  </circle>
                  <circle r="5" fill={C.crimson}>
                    <animateMotion dur="6.4s" begin="-0.5s" repeatCount="indefinite" path={race.outline} />
                  </circle>
                </>
              )}
            </>
          )}
        </svg>
      </div>
      <div className={`absolute left-[9%] top-[8%] rounded-md bg-[#080B10] px-[0.6em] py-[0.25em] ${mono} text-[0.5em] text-neon`}>▶ 3D replay</div>
    </Sticker>
  );
}

/** Top-down car silhouette (generic). */
export function CarTop({ color, ghost = false, className = '' }: { color: string; ghost?: boolean; className?: string }) {
  const stroke = ghost ? C.ghost : '#0b0d10';
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden style={ghost ? { filter: `drop-shadow(0 0 6px ${C.ghost})` } : undefined}>
      <g fill={ghost ? 'rgba(0,245,212,0.18)' : color} stroke={stroke} strokeWidth="1.6" strokeLinejoin="round">
        <rect x="3" y="2" width="34" height="7" rx="2" />
        <path d="M18 8 L22 8 L24 34 L31 44 L31 70 L25 84 L15 84 L9 70 L9 44 L16 34 Z" />
        <rect x="5" y="88" width="30" height="8" rx="2" />
      </g>
      <g fill={ghost ? 'none' : '#14161a'} stroke={stroke} strokeWidth="1.4">
        <rect x="1" y="20" width="7" height="13" rx="2" />
        <rect x="32" y="20" width="7" height="13" rx="2" />
        <rect x="0" y="70" width="8" height="15" rx="2" />
        <rect x="32" y="70" width="8" height="15" rx="2" />
      </g>
      <circle cx="20" cy="52" r="3.4" fill={ghost ? C.ghost : '#fff'} stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

/** TO REWRITE: ghost car vs real car, real computed preset. */
export function GhostSticker({ race }: { race: FeatureRace | null }) {
  const p = race?.preset;
  return (
    <Sticker bg={C.asphalt} edge="#000" tilt={5} tape="corner" className="h-full w-full">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(0,245,212,0.22),transparent_65%)]" />
      {/* lanes */}
      <div className="absolute inset-y-0 left-[30%] w-px bg-white/15" />
      <div className="absolute inset-y-0 left-[70%] w-px bg-white/15" />
      <div className="absolute bottom-[8%] left-[56%] top-[24%] w-[3%] rounded-full bg-[linear-gradient(0deg,transparent,rgba(0,245,212,0.75))]" />
      <CarTop color={p?.color ?? '#9aa1aa'} ghost className="absolute left-[44%] top-[12%] h-[42%] w-[24%] -rotate-3" />
      <CarTop color={p?.color ?? '#9aa1aa'} className="absolute left-[22%] top-[48%] h-[40%] w-[22%] rotate-2" />
      <div className={`absolute left-[8%] top-[7%] ${mono} text-[0.5em] text-ghost`}>ghost</div>
      <div className={`absolute bottom-[7%] left-[8%] ${mono} text-[0.5em] text-white/70`}>{p ? `real · ${p.code}` : 'real'}</div>
    </Sticker>
  );
}

/** Small white verdict label stuck on the ghost card. */
export function VerdictSticker({ race }: { race: FeatureRace | null }) {
  const p = race?.preset;
  return (
    <div className="rotate-[-6deg] rounded-[0.5em] border-[0.12em] border-[#080B10] bg-white px-[0.6em] py-[0.4em] text-[#080B10] shadow-[0_0.4em_1em_rgba(0,0,0,0.25)]">
      <div className="font-display text-[2.2em] leading-[0.95]">{p ? `${p.gained > 0 ? '+' : ''}${p.gained} POS` : 'GHOST'}</div>
      <div className="mt-[0.2em] font-mono text-[0.55em] font-semibold uppercase tracking-[0.1em]">
        {p ? `${p.code} P${p.from ?? '—'} → P${p.to} · ${p.delta.toFixed(2)}s` : 'computing what-if…'}
      </div>
    </div>
  );
}

/** TO DEBRIEF: season stats, real numbers from useSeason(). */
export function SeasonSticker({ stats }: { stats: LandingStats }) {
  const r = stats.ready;
  const f = (n: number) => (r ? n.toLocaleString('en-GB') : '—');
  const cells: [string, string][] = [
    ['Races run', f(stats.completed)],
    ['Winners', f(stats.distinctWinners)],
    ['Overtakes', f(stats.overtakes)],
    ['Penalties', f(stats.penaltiesIssued)],
  ];
  return (
    <Sticker bg={C.orange} edge={C.orangeDeep} tilt={-6} className="h-full w-full">
      <div className="absolute inset-0 flex flex-col p-[10%]">
        <div className={`${mono} text-[0.55em] font-semibold text-[#080B10]/70`}>2026 debrief</div>
        <div className="mt-[4%] grid flex-1 grid-cols-2 gap-[6%]">
          {cells.map(([k, v]) => (
            <div key={k} className="flex flex-col justify-center rounded-[0.6em] bg-[#080B10] px-[0.6em]">
              <div className="font-display text-[1.9em] leading-none text-neon">{v}</div>
              <div className={`${mono} mt-[0.3em] text-[0.42em] text-white/60`}>{k}</div>
            </div>
          ))}
        </div>
        <div className={`mt-[6%] ${mono} text-[0.55em] font-semibold text-[#080B10]`}>
          {stats.leader ? (
            <>
              Leader <span className="rounded bg-[#080B10] px-1" style={{ color: stats.leader.color }}>{stats.leader.code}</span> · {stats.leader.points} pts
            </>
          ) : (
            'standings: no data yet'
          )}
        </div>
      </div>
    </Sticker>
  );
}

/** Second debrief sticker: safety-car / neutralisation tallies. */
export function NeutralSticker({ stats }: { stats: LandingStats }) {
  const f = (n: number) => (stats.ready ? String(n) : '—');
  return (
    <Sticker bg="#F2F2F2" edge="#b9bcc2" tilt={7} tapeDark className="h-full w-full">
      <div className="absolute inset-0 flex flex-col justify-between p-[11%] text-[#080B10]">
        <div className={`${mono} text-[0.55em] font-semibold text-[#080B10]/60`}>Race control</div>
        <div className="flex items-end gap-[8%]">
          {[
            ['SC', stats.safetyCars, '#FFD400'],
            ['VSC', stats.vscs, '#FF7A00'],
            ['RED', stats.redFlags, '#FF1E1E'],
          ].map(([k, v, c]) => (
            <div key={k as string} className="flex-1">
              <div className="rounded-[0.3em]" style={{ height: `${2.2 + Math.min(4, (v as number) * 0.25)}em`, background: c as string }} />
              <div className="mt-[0.3em] font-display text-[1.3em] leading-none">{f(v as number)}</div>
              <div className={`${mono} text-[0.42em]`}>{k}</div>
            </div>
          ))}
        </div>
      </div>
    </Sticker>
  );
}
