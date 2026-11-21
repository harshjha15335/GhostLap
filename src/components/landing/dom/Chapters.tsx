import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { HotspotId, LandingBus } from '../bus';
import type { LandingLayout } from '../layout';
import type { LandingStats } from '../stats';
import KineticHeadline from './KineticHeadline';

const fmt = (n: number, ready: boolean) => (ready ? n.toLocaleString('en-GB') : '—');

export function ChapterTag({ n, title, className = '' }: { n: number; title: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-white/60 ${className}`}>
      <span className="rounded-[3px] bg-neon px-1.5 py-0.5 font-semibold text-asphalt">CH.{String(n).padStart(2, '0')}</span>
      <span>{title}</span>
      <span className="hidden h-px w-16 bg-white/20 sm:block" />
    </div>
  );
}

/* ---------------------------------- 01 hero --------------------------------- */

const HEADLINE = [
  { text: 'REWRITE', className: 'kl-white' },
  { text: 'THE RACE', className: 'kl-neon' },
];

export function HeroChapter({
  stats,
  reduced,
  soundOn,
  onToggleSound,
}: {
  stats: LandingStats;
  reduced: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
}) {
  return (
    <div className="relative flex min-h-[100svh] flex-col px-4 pb-8 pt-16 sm:px-8">
      <div className="flex items-start justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-white/70">
        <div>
          <div className="text-white">
            GHOSTLAP <span className="text-neon">//</span> 2026 FIELD GUIDE
          </div>
          <div className="mt-1 text-white/40">Vol. 01 · Night Session</div>
        </div>
        <button
          type="button"
          onClick={onToggleSound}
          className="pointer-events-auto rounded-full border border-white/25 px-3 py-1 text-[10px] text-white/70 transition hover:border-neon hover:text-neon"
          aria-pressed={soundOn}
        >
          SFX {soundOn ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="sticker mb-6 inline-flex -rotate-2 items-center gap-2 rounded-full border-2 border-asphalt bg-neon px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-asphalt sm:text-xs">
          <span>2026 Season</span>
          <span aria-hidden>·</span>
          <span className="rounded-sm bg-asphalt px-1.5 text-neon">[GHOSTLAP]</span>
          <span aria-hidden>·</span>
          <span>22 Cars</span>
        </div>
        <div className="pointer-events-auto">
          <KineticHeadline lines={HEADLINE} reduced={reduced} className="text-[clamp(84px,22vw,240px)] sm:text-[clamp(96px,15vw,240px)]" />
        </div>
        <p className="mt-6 max-w-md text-balance text-sm text-white/70 sm:text-base">
          A kinetic debrief of the 2026 season — and a ghost car for every call that was never made.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/50 sm:text-[11px]">
        <span>
          <span className="text-white">{fmt(stats.completed, stats.ready)}</span> races run ·{' '}
          <span className="text-white">{fmt(stats.overtakes, stats.ready)}</span> overtakes logged
        </span>
        <span className="scroll-cue flex items-center gap-2 text-neon">
          Scroll to drive <span aria-hidden>↓</span>
        </span>
      </div>
    </div>
  );
}

/* -------------------------------- 02 specimen ------------------------------- */

export const HOTSPOTS: { id: HotspotId; label: string; code: string; body: string; color: string }[] = [
  { id: 'aero', label: 'Active Aero Wings', code: 'AA-26', body: 'Front and rear flaps open for a low-drag straight-line mode, then close for corner grip.', color: '#D4FF00' },
  { id: 'halo', label: 'Halo', code: 'HL-26', body: 'Titanium cockpit hoop over the survival cell.', color: '#F2F2F2' },
  { id: 'wake', label: 'Dirty-Air Wake', code: 'DA-26', body: 'Turbulent air shed behind the car, robbing a follower of downforce.', color: '#FF7A00' },
  { id: 'tyres', label: 'Compound Tyre Rings', code: 'TY-26', body: 'Glowing sidewall rings: red soft, yellow medium, white hard.', color: '#FF1E1E' },
];

export function SpecimenChapter({ hover, setHover }: { hover: HotspotId | null; setHover: (h: HotspotId | null) => void }) {
  return (
    <div className="sticky top-0 flex h-[100svh] flex-col justify-end px-4 pb-8 pt-16 sm:justify-center sm:px-8 sm:pb-0">
      <div className="max-w-[420px]">
        <ChapterTag n={2} title="Specimen study" />
        <h2 className="mt-4 font-display text-[clamp(44px,9vw,104px)] uppercase leading-[0.9]">
          The 2026
          <br />
          <span className="text-neon">machine</span>
        </h2>
        <p className="mt-3 max-w-sm text-sm text-white/65">
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
                  hover === h.id ? 'border-white/60 bg-white/10 text-white' : 'border-white/10 bg-panel/70 text-white/70'
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
            className={`pointer-events-none absolute left-5 top-3 w-max max-w-[220px] origin-top-left rounded-md border bg-asphalt/90 px-2.5 py-1.5 backdrop-blur transition ${
              hover === h.id ? 'scale-100 border-white/40' : 'scale-95 border-white/10'
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
      className="drive-card pointer-events-auto relative rounded-xl border border-white/10 bg-panel/85 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-5"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <span className="absolute -top-3 left-4 rounded-[3px] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-asphalt" style={{ background: accent }}>
        {kicker}
      </span>
      {tag && (
        <span className="sticker absolute -right-2 -top-4 rotate-6 rounded-full border-2 border-asphalt bg-white px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-asphalt">
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

export function DriveChapter({ layout, stats }: { layout: LandingLayout; stats: LandingStats }) {
  const r = stats.ready;
  const f = (n: number) => fmt(n, r);
  const cards: ReactNode[] = [
    <Card key="fav" kicker="Favourites vs results" title="Pole is power" accent="#D4FF00" tilt={-1.5} tag={r ? `${stats.distinctWinners} winners` : undefined}>
      <Big v={r ? `${stats.poleWins}/${stats.completed}` : '—'} unit="poles → wins" color="#D4FF00" />
      <Bar value={stats.poleWins} max={stats.completed} color="#D4FF00" />
      <div className="mt-3">
        <Row k="Won from quali top 3" v={r ? `${stats.top3QualiWins} of ${stats.completed}` : '—'} />
        <Row k="Different winners" v={f(stats.distinctWinners)} />
      </div>
    </Card>,
    <Card key="upg" kicker="Team upgrades" title="Pace steps" accent="#00F5D4" tilt={1.2}>
      <Big v={f(stats.upgradeSteps)} unit={`detected · ${r ? stats.upgradeTeams : '—'} teams`} color="#00F5D4" />
      {stats.biggestUpgrade && (
        <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2.5 font-mono text-[11px] uppercase tracking-[0.08em]">
          <div className="text-white/50">Biggest step</div>
          <div className="mt-1 flex items-center gap-2 text-white">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: stats.biggestUpgrade.color }} />
            {stats.biggestUpgrade.team} · R{stats.biggestUpgrade.round}
            <span className="ml-auto text-ghost">{stats.biggestUpgrade.delta.toFixed(2)}%</span>
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
    <Card key="cliff" kicker="Telemetry" title="Tyre cliff" accent="#FFD400" tilt={-1.4}>
      <svg viewBox="0 0 220 70" className="h-[70px] w-full" aria-hidden>
        <path d="M4 18 C60 22 110 26 146 32 S178 40 186 64" fill="none" stroke="#FFD400" strokeWidth="3" strokeLinecap="round" />
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

  return (
    <div className="relative" style={{ height: layout.sectionPx }}>
      <div className="absolute inset-x-0 top-0 px-4 pt-20 sm:px-8" style={{ height: layout.rotatePx }}>
        <ChapterTag n={3} title="Scroll drive" />
        <h2 className="mt-4 max-w-3xl font-display text-[clamp(44px,8vw,112px)] uppercase leading-[0.9]">
          The season,
          <br />
          in <span className="text-crimson">tyre marks</span>
        </h2>
      </div>
      {layout.cards.map((c, i) => (
        <div key={i} className="absolute" style={{ top: c.top, left: c.left, width: layout.cardW }}>
          {cards[i]}
        </div>
      ))}
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
          22 cars.
          <br />
          <span className="text-neon">One ribbon.</span>
        </h2>
      </div>
      <div className="pointer-events-auto max-w-3xl">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">The 2026 grid · team colours</div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
          {stats.grid.map((g, i) => (
            <span
              key={`${g.code}-${i}`}
              title={g.team}
              className="flex items-center gap-1.5 rounded-[4px] border border-white/10 bg-asphalt/70 px-1.5 py-1 font-mono text-[10px] font-semibold text-white/85 backdrop-blur"
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

/* -------------------------------- 05 undercut ------------------------------- */

export function UndercutChapter() {
  return (
    <div className="sticky top-0 flex h-[100svh] flex-col justify-between px-4 pb-8 pt-16 sm:px-8">
      <div>
        <ChapterTag n={5} title="Ghost undercut" />
        <h2 className="mt-3 font-display text-[clamp(40px,7vw,96px)] uppercase leading-[0.9]">
          Box <span className="text-ghost">early.</span>
        </h2>
      </div>
      <div className="sticker inline-flex w-max max-w-full rotate-[-1.5deg] flex-wrap items-center gap-x-2 rounded-full border-2 border-asphalt bg-ghost px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-asphalt">
        Undercut <span aria-hidden>·</span> −3 laps <span aria-hidden>·</span> +1 pos
        <span className="rounded-sm bg-asphalt px-1.5 text-[10px] text-ghost">preview</span>
      </div>
    </div>
  );
}

export function UndercutLabels({ bus }: { bus: LandingBus }) {
  const reg = (id: string) => (el: HTMLElement | null) => {
    bus.anchors[id] = el;
  };
  const base = 'absolute left-0 top-0 opacity-0';
  const pill = '-translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]';
  return (
    <>
      <div ref={reg('ug-box')} className={base} style={{ visibility: 'hidden' }}>
        <div className={`${pill} border border-ghost/60 bg-asphalt/80 text-ghost`}>Pit lane · box</div>
      </div>
      <div ref={reg('ug-ghost')} className={base} style={{ visibility: 'hidden' }}>
        <div className={`${pill} bg-ghost text-asphalt`}>Ghost</div>
      </div>
      <div ref={reg('ug-rival')} className={base} style={{ visibility: 'hidden' }}>
        <div className={`${pill} bg-crimson text-white`}>Rival</div>
      </div>
      <div ref={reg('ug-real')} className={base} style={{ visibility: 'hidden' }}>
        <div className={`${pill} bg-neon text-asphalt`}>Stayed out</div>
      </div>
      <div ref={reg('ug-gain')} className={base} style={{ visibility: 'hidden' }}>
        <div className="sticker -translate-y-full rotate-[-4deg] rounded-md border-2 border-asphalt bg-white px-2 py-1 font-display text-2xl leading-none text-asphalt">+1 POS</div>
      </div>
    </>
  );
}

/* --------------------------------- 06 launch -------------------------------- */

export function LaunchChapter({ stats }: { stats: LandingStats }) {
  return (
    <div className="relative flex min-h-[100svh] flex-col justify-center px-4 pb-10 pt-16 sm:px-8">
      <ChapterTag n={6} title="Launch gate" />
      <h2 className="mt-4 font-display text-[clamp(56px,12vw,180px)] uppercase leading-[0.86]">
        Your <span className="text-neon">call.</span>
      </h2>
      <div className="pointer-events-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
        <Link to="/circuits" className="group rounded-xl border border-white/10 bg-panel/80 p-5 backdrop-blur transition hover:-rotate-1 hover:border-neon">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">3D circuit directory</div>
          <div className="mt-2 flex items-center justify-between font-display text-3xl uppercase">
            Circuits <span className="text-neon transition group-hover:translate-x-1">→</span>
          </div>
          <div className="mt-1 text-xs text-white/55">{stats.ready ? `${stats.racesTotal} rounds on the calendar` : 'Every round on the calendar'}</div>
        </Link>
        <Link to="/season" className="group rounded-xl border border-white/10 bg-panel/80 p-5 backdrop-blur transition hover:rotate-1 hover:border-ghost">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">Season intelligence</div>
          <div className="mt-2 flex items-center justify-between font-display text-3xl uppercase">
            Season <span className="text-ghost transition group-hover:translate-x-1">→</span>
          </div>
          <div className="mt-1 text-xs text-white/55">
            {stats.leader ? (
              <>
                Leader <span style={{ color: stats.leader.color }}>{stats.leader.code}</span> · {stats.leader.points} pts
              </>
            ) : (
              'Standings, pace and penalties'
            )}
          </div>
        </Link>
      </div>
      <Link
        to="/replay/silverstone?autoplay=1"
        className="launch-cta pointer-events-auto mt-8 inline-flex w-max max-w-full items-center gap-3 rounded-full border-2 border-asphalt bg-neon px-7 py-4 font-display text-xl uppercase tracking-wide text-asphalt transition hover:-translate-y-0.5 sm:text-2xl"
      >
        Launch 3D Race Lab <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
