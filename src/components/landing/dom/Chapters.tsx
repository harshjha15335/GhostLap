import { useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import * as THREE from 'three';
import { smooth01, type ScrollChoreography } from '@/hooks/useScrollChoreography';
import type { HotspotId, LandingBus } from '../bus';
import { CARD_HALF, CARD_LAPS, driveLapT, type LandingLayout } from '../layout';
import type { DrivePath } from '../scene/drivePath';
import type { LandingStats } from '../stats';
import KineticHeadline from './KineticHeadline';
import Logo from '@/components/ui/Logo';

const fmt = (n: number, ready: boolean) => (ready ? n.toLocaleString('en-GB') : '—');

export function ChapterTag({ n, title, className = '', ink = false }: { n: number; title: string; className?: string; ink?: boolean }) {
  return (
    <div className={`flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] ${ink ? 'text-ink/80' : 'text-cream/85'} ${className}`}>
      <span className={`rounded-[3px] px-1.5 py-0.5 font-semibold ${ink ? 'bg-ink text-pop-sun' : 'bg-pop-sun text-ink'}`}>CH.{String(n).padStart(2, '0')}</span>
      <span>{title}</span>
      <span className={`hidden h-px w-16 sm:block ${ink ? 'bg-ink/40' : 'bg-cream/40'}`} />
    </div>
  );
}

/* ---------------------------------- 01 hero --------------------------------- */

const HEADLINE = [
  { text: 'REWRITE', className: 'kl-hero' },
  { text: 'THE RACE', className: 'kl-hero' },
];

export function HeroChapter({
  reduced,
  soundOn,
  onToggleSound,
  headRef,
  cueRef,
}: {
  stats: LandingStats;
  reduced: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  /** headline block: the 3D car is framed in the free band below it */
  headRef?: Ref<HTMLDivElement>;
  cueRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="relative flex min-h-[100svh] flex-col px-4 pb-5 pt-[60px] sm:px-8">
      <div className="absolute right-4 top-[72px] z-10 sm:right-8">
        <button
          type="button"
          onClick={onToggleSound}
          className="pointer-events-auto rounded-full border-2 border-cream/80 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-cream transition hover:bg-cream hover:text-pop-blue"
          aria-pressed={soundOn}
        >
          SFX {soundOn ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* the big stacked title owns the first screen; the 3D car sits on the horizon right below it */}
      <div ref={headRef} className="flex flex-col items-center pt-[7svh] text-center sm:pt-[3svh]">
        {/* kicker: WE'RE [sticker] HERE TO */}
        <div className="relative z-10 mb-[-0.32em] flex items-center justify-center gap-[0.4em] font-display text-[clamp(24px,min(4.2vw,7svh),54px)] uppercase leading-none text-cream">
          <span className="-rotate-2">We&apos;re</span>
          <Logo tilt={-8} />
          <span className="rotate-2">here to</span>
        </div>
        <div className="pointer-events-auto">
          <KineticHeadline
            wonky
            lines={HEADLINE}
            reduced={reduced}
            className="text-[clamp(84px,min(25vw,15svh),300px)] sm:text-[clamp(110px,min(17vw,30svh),300px)]"
          />
        </div>
      </div>

      <div className="flex-1" />

      <div ref={cueRef} className="flex justify-center font-mono text-[10px] uppercase tracking-[0.2em] sm:justify-start sm:text-[11px]">
        <span className="scroll-cue flex items-center gap-2 rounded-full border-2 border-ink bg-pop-sun px-3 py-1.5 font-semibold text-ink shadow-[0_3px_0_#170F33]">
          Scroll to drive <span aria-hidden>↓</span>
        </span>
      </div>
    </div>
  );
}

/* -------------------------------- 02 specimen ------------------------------- */

export const HOTSPOTS: { id: HotspotId; label: string; code: string; body: string; color: string }[] = [
  { id: 'aero', label: 'Active Aero Wings', code: 'AA-26', body: 'Front and rear flaps open for a low-drag straight-line mode, then close for corner grip.', color: '#FFD23F' },
  { id: 'halo', label: 'Halo', code: 'HL-26', body: 'Titanium cockpit hoop over the survival cell.', color: '#F2F2F2' },
  { id: 'wake', label: 'Dirty-Air Wake', code: 'DA-26', body: 'Turbulent air shed behind the car, robbing a follower of downforce.', color: '#FF7A00' },
  { id: 'tyres', label: 'Compound Tyre Rings', code: 'TY-26', body: 'Glowing sidewall rings: red soft, yellow medium, white hard.', color: '#FF1E1E' },
];

export function SpecimenChapter({ hover, setHover }: { hover: HotspotId | null; setHover: (h: HotspotId | null) => void }) {
  return (
    <div className="sticky top-0 flex h-[100svh] flex-col justify-end px-4 pb-8 pt-16 sm:justify-center sm:px-8 sm:pb-0">
      <div className="max-w-[420px]">
        <ChapterTag n={2} title="Specimen study" ink />
        <h2 className="mt-4 font-display text-[clamp(44px,9vw,104px)] uppercase leading-[0.9] text-ink">
          The 2026
          <br />
          <span className="kl-cream">machine</span>
        </h2>
        <p className="mt-3 max-w-sm text-sm font-medium text-ink/85">
          Narrower, lighter, wings that move. Tilt it with your cursor; tap a tag to dissect it.
        </p>
        <ul className="pointer-events-auto mt-5 grid grid-cols-2 gap-2 sm:grid-cols-1">
          {HOTSPOTS.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                data-hotspot
                onMouseEnter={() => setHover(h.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(h.id)}
                onBlur={() => setHover(null)}
                onClick={() => setHover(hover === h.id ? null : h.id)}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] transition ${
                  hover === h.id ? 'border-ink bg-pop-sun text-ink' : 'border-ink bg-ink/90 text-cream/90'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: h.color, boxShadow: `0 0 10px ${h.color}` }} />
                <span className="truncate">{h.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Hotspot pins projected from 3D (positioned by HeroCar each frame). */
export function HotspotPins({ bus, hover, setHover }: { bus: LandingBus; hover: HotspotId | null; setHover: (h: HotspotId | null) => void }) {
  return (
    <>
      {HOTSPOTS.map((h) => (
        <div
          key={h.id}
          ref={(el) => {
            bus.anchors[`hs-${h.id}`] = el;
          }}
          className="absolute left-0 top-0 opacity-0"
          style={{ visibility: 'hidden' }}
        >
          <button
            type="button"
            data-hotspot
            aria-label={h.label}
            onMouseEnter={() => setHover(h.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === h.id ? null : h.id)}
            className="pointer-events-auto relative -translate-x-1/2 -translate-y-1/2"
          >
            <span className="hs-ring block h-7 w-7 rounded-full border-2" style={{ borderColor: h.color }} />
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: h.color }} />
          </button>
          <div
            className={`pointer-events-none absolute left-5 top-3 w-max max-w-[220px] origin-top-left rounded-md border bg-ink/90 px-2.5 py-1.5 backdrop-blur transition ${
              hover === h.id ? 'scale-100 border-white/40' : 'scale-95 border-white/10 max-sm:hidden'
            }`}
          >
            <div className="font-mono text-[9px] tracking-[0.2em] text-white/50">{h.code}</div>
            <div className="font-display text-base uppercase leading-tight" style={{ color: h.color }}>
              {h.label}
            </div>
            {hover === h.id && <div className="mt-1 text-[11px] leading-snug text-white/75">{h.body}</div>}
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------------------------- 03 drive -------------------------------- */

function Card({
  kicker,
  title,
  accent,
  children,
  tilt,
  tag,
}: {
  kicker: string;
  title: string;
  accent: string;
  children: ReactNode;
  tilt: number;
  tag?: string;
}) {
  return (
    <article
      className="drive-card pointer-events-auto relative rounded-xl border-2 border-ink bg-ink/95 p-4 text-cream shadow-[6px_8px_0_rgba(23,15,51,0.35)] sm:p-5"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <span className="absolute -top-3 left-4 rounded-[3px] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink" style={{ background: accent }}>
        {kicker}
      </span>
      {tag && (
        <span className="sticker absolute -right-2 -top-4 rotate-6 rounded-full border-2 border-ink bg-pop-pink px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-ink">
          {tag}
        </span>
      )}
      <h3 className="mt-1 font-display text-2xl uppercase leading-none sm:text-[28px]">{title}</h3>
      <div className="mt-3">{children}</div>
    </article>
  );
}

function Big({ v, unit, color = '#fff' }: { v: string; unit?: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-display text-5xl leading-none" style={{ color }}>
        {v}
      </span>
      {unit && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">{unit}</span>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em]">
      <span className="text-white/55">{k}</span>
      <span className="text-white">{v}</span>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
    </div>
  );
}

const CARD_SIDES: (1 | -1)[] = [-1, 1, -1, 1, -1, 1];

/** Minimap polyline of the drive path in the overview's orientation (screen up = +Z, right = -X). */
function useMinimap(path: DrivePath) {
  return useMemo(() => {
    const N = 400;
    const v = new THREE.Vector3();
    const { cx, cz, hx, hz } = path.bounds;
    const k = 46 / Math.max(hx, hz);
    const pts: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      path.point(i / N, v);
      pts.push([50 - (v.x - cx) * k, 50 - (v.z - cz) * k]);
    }
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    return { pts, d, N };
  }, [path]);
}

export function DriveChapter({
  layout,
  stats,
  path,
  subscribe,
}: {
  layout: LandingLayout;
  stats: LandingStats;
  path: DrivePath;
  subscribe: ScrollChoreography['subscribe'];
}) {
  const r = stats.ready;
  const f = (n: number) => fmt(n, r);
  const cards: ReactNode[] = [
    <Card key="fav" kicker="Favourites vs results" title="Pole is power" accent="#FF2E88" tilt={-1.5} tag={r ? `${stats.distinctWinners} winners` : undefined}>
      <Big v={r ? `${stats.poleWins}/${stats.completed}` : '—'} unit="poles → wins" color="#FF2E88" />
      <Bar value={stats.poleWins} max={stats.completed} color="#FF2E88" />
      <div className="mt-3">
        <Row k="Won from quali top 3" v={r ? `${stats.top3QualiWins} of ${stats.completed}` : '—'} />
        <Row k="Different winners" v={f(stats.distinctWinners)} />
      </div>
    </Card>,
    <Card key="upg" kicker="Team upgrades" title="Pace steps" accent="#9ED8FF" tilt={1.2}>
      <Big v={f(stats.upgradeSteps)} unit={`detected · ${r ? stats.upgradeTeams : '—'} teams`} color="#9ED8FF" />
      {stats.biggestUpgrade && (
        <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2.5 font-mono text-[11px] uppercase tracking-[0.08em]">
          <div className="text-white/50">Biggest step</div>
          <div className="mt-1 flex items-center gap-2 text-white">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: stats.biggestUpgrade.color }} />
            {stats.biggestUpgrade.team} · R{stats.biggestUpgrade.round}
            <span className="ml-auto text-pop-sky">{stats.biggestUpgrade.delta.toFixed(2)}%</span>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-white/45">Detected from race-pace gaps to the fastest car.</p>
    </Card>,
    <Card key="pen" kicker="FIA penalties" title="Stewards' desk" accent="#FF1E1E" tilt={-0.8} tag={r ? `${stats.stewardsNotes} notes` : undefined}>
      <Big v={f(stats.penaltiesIssued)} unit="penalties issued" color="#FF1E1E" />
      <div className="mt-3">
        <Row k="Time penalties" v={f(stats.timePenalties)} />
        <Row k="Drive-through / stop-go" v={f(stats.driveThroughs)} />
        <Row k="Investigations opened" v={f(stats.investigations)} />
      </div>
    </Card>,
    <Card key="dirty" kicker="Telemetry" title="Dirty air downforce drain" accent="#FF7A00" tilt={1.6}>
      <div className="flex items-end gap-1" aria-hidden>
        {[1, 0.92, 0.8, 0.66, 0.55, 0.5, 0.58, 0.72].map((h, i) => (
          <span key={i} className="w-full rounded-sm" style={{ height: `${h * 54}px`, background: i > 2 && i < 7 ? '#FF7A00' : 'rgba(255,255,255,0.25)' }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">
        <span>clean air</span>
        <span>in the wake</span>
      </div>
      <Row k="Overtakes logged (2026)" v={f(stats.overtakes)} />
    </Card>,
    <Card key="cliff" kicker="Telemetry" title="Tyre cliff" accent="#FFD23F" tilt={-1.4}>
      <svg viewBox="0 0 220 70" className="h-[70px] w-full" aria-hidden>
        <path d="M4 18 C60 22 110 26 146 32 S178 40 186 64" fill="none" stroke="#FFD23F" strokeWidth="3" strokeLinecap="round" />
        <line x1="150" y1="6" x2="150" y2="66" stroke="#FF1E1E" strokeDasharray="3 4" />
        <text x="154" y="14" fill="#FF1E1E" fontSize="9" fontFamily="JetBrains Mono">CLIFF</text>
      </svg>
      <p className="text-[12px] text-white/60">Lap time holds, then falls off a ledge. Pit a lap early and the ghost finds out what you'd have gained.</p>
    </Card>,
    <Card key="sc" kicker="Telemetry" title="Safety car pit window" accent="#F2F2F2" tilt={1}>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['SC', stats.safetyCars],
          ['VSC', stats.vscs],
          ['RED', stats.redFlags],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-md border border-white/10 bg-black/30 p-2 text-center">
            <div className="font-display text-3xl leading-none">{f(v as number)}</div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.16em] text-white/50">{k}</div>
          </div>
        ))}
      </div>
      <Row k="Races neutralised" v={r ? `${stats.neutralisedRaces} of ${stats.completed}` : '—'} />
    </Card>,
  ];

  const cardEls = useRef<(HTMLDivElement | null)[]>([]);
  const hud = useRef<HTMLDivElement>(null);
  const hudText = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const map = useMinimap(path);

  useEffect(() => {
    const L = layout;
    let heights: number[] = [];
    const measure = () => {
      heights = cardEls.current.map((el) => el?.offsetHeight ?? 320);
    };
    measure();
    const ro = new ResizeObserver(measure);
    cardEls.current.forEach((el) => el && ro.observe(el));
    let lastText = '';
    const unsub = subscribe((s) => {
      const top = s.chapters[2]?.top ?? 0;
      const d = s.scrollY - top;
      const lap = driveLapT(L, s.scrollY, top);
      const driving = d > L.introPx * 0.7 && d < L.introPx + L.drivePx + L.outroPx * 0.6;

      // HUD: circuit · sector · distance · lap %
      const h = hud.current;
      if (h) h.style.opacity = driving ? '1' : '0';
      const card = Math.min(CARD_LAPS.length, CARD_LAPS.filter((c) => lap >= c - CARD_HALF).length);
      const text = `SCROLL DRIVE · ${String(card).padStart(2, '0')}/${String(CARD_LAPS.length).padStart(2, '0')} · ${Math.round(lap * 100)}%`;
      if (text !== lastText && hudText.current) {
        hudText.current.textContent = text;
        lastText = text;
      }
      if (bar.current) bar.current.style.transform = `scaleX(${lap.toFixed(4)})`;
      if (dot.current && map) {
        const p = map.pts[Math.min(map.N, Math.round(lap * map.N))];
        dot.current.setAttribute('cx', p[0].toFixed(1));
        dot.current.setAttribute('cy', p[1].toFixed(1));
      }

      // cards travel past the car on the sides (desktop) or rise into a dock under it (mobile)
      const inLap = d > L.introPx * 0.9 && d < L.introPx + L.drivePx + L.vh * 0.2;
      CARD_LAPS.forEach((c, i) => {
        const el = cardEls.current[i];
        if (!el) return;
        const u = (lap - (c - CARD_HALF)) / (2 * CARD_HALF);
        if (!inLap || u <= 0 || u >= 1) {
          if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
          return;
        }
        const ch = heights[i] ?? 320;
        let y: number;
        let o = 1;
        if (L.mobile) {
          const rest = Math.min(L.dockTop, L.vh - ch - 16);
          if (u < 0.22) y = L.vh + 16 + (rest - L.vh - 16) * smooth01(u / 0.22);
          else if (u > 0.8) {
            const k = (u - 0.8) / 0.2;
            y = rest - 50 * k;
            o = 1 - k;
          } else y = rest;
        } else {
          y = L.vh + 24 - u * (L.vh + 48 + ch);
          // slide under the HUD rather than across it
          o = Math.max(0, Math.min(1, (y + ch * 0.5 - 110) / (ch * 0.5)));
        }
        el.style.visibility = 'visible';
        el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
        el.style.opacity = o.toFixed(3);
      });
    });
    return () => {
      unsub();
      ro.disconnect();
    };
  }, [layout, subscribe, path, map]);

  return (
    <div className="relative" style={{ height: layout.sectionPx }}>
      {/* sticky stage: HUD + cards over the circuit */}
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div ref={hud} className="absolute inset-x-0 top-[60px] z-10 flex items-start justify-between gap-3 px-4 opacity-0 transition-opacity duration-300 sm:px-8">
          <div className="min-w-0 rounded-md border-2 border-ink bg-ink/90 px-2.5 py-1.5">
            <span ref={hudText} className="block font-mono text-[9px] uppercase tracking-[0.18em] text-white/85 sm:text-[11px]">
              SCROLL DRIVE · 00/06 · 0%
            </span>
            <span className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-white/15">
              <span ref={bar} className="block h-full w-full origin-left rounded-full bg-pop-pink" style={{ transform: 'scaleX(0)' }} />
            </span>
          </div>
          {map && (
            <svg viewBox="0 0 100 100" className="h-16 w-16 shrink-0 rounded-md border-2 border-ink bg-ink/90 p-1 sm:h-24 sm:w-24" aria-hidden>
              <path d={map.d} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={map.pts[0][0]} cy={map.pts[0][1]} r="3" fill="#F2F2F2" />
              <circle ref={dot} cx={map.pts[0][0]} cy={map.pts[0][1]} r="4.5" fill="#FF2E88" stroke="#170F33" strokeWidth="1.5" />
            </svg>
          )}
        </div>
        {cards.map((card, i) => (
          <div
            key={i}
            ref={(el) => {
              cardEls.current[i] = el;
            }}
            className="absolute top-0"
            style={{ left: layout.cardLeft[layout.mobile ? -1 : CARD_SIDES[i]], width: layout.cardW, visibility: 'hidden', willChange: 'transform' }}
          >
            {card}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 top-0 px-4 pt-20 sm:px-8" style={{ height: layout.introPx }}>
        <ChapterTag n={3} title="Scroll drive" ink />
        <h2 className="mt-4 max-w-3xl font-display text-[clamp(44px,8vw,112px)] uppercase leading-[0.9] text-ink">
          The season,
          <br />
          in <span className="text-pop-blue">tyre marks</span>
        </h2>
        <p className="mt-3 inline-block max-w-md rounded-[4px] bg-ink px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-pop-sun">
          Six numbers from the 2026 season · scroll to drive
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- 04 flow --------------------------------- */

export function FlowChapter({ stats }: { stats: LandingStats }) {
  return (
    <div className="sticky top-0 flex h-[100svh] flex-col justify-between px-4 pb-6 pt-16 sm:px-8">
      <div>
        <ChapterTag n={4} title="22-car flow" />
        <h2 className="mt-3 font-display text-[clamp(40px,7vw,96px)] uppercase leading-[0.9]">
          <span className="kl-cream">22 cars.</span>
          <br />
          <span className="kl-sun">One ribbon.</span>
        </h2>
      </div>
      <div className="pointer-events-auto max-w-3xl">
        <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-cream/85">The 2026 grid · team colours</div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
          {stats.grid.map((g, i) => (
            <span
              key={`${g.code}-${i}`}
              title={g.team}
              className="flex items-center gap-1.5 rounded-[4px] border border-ink bg-ink/85 px-1.5 py-1 font-mono text-[10px] font-semibold text-cream/90"
            >
              <span className="h-2 w-1 rounded-full" style={{ background: g.color }} />
              {g.code}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
