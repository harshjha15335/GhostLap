import { useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { LandingStats } from '../stats';
import CompoundDisc from './CompoundDisc';
import { clamp, easeOut, useDocBox, useFlowFrame } from './motion';
import { CarTop } from './Stickers';
import type { Vp } from './Strategist';
import { C, type CompoundKey } from './theme';

const PILE: { c: CompoundKey; x: number; y: number; d: number; r: number }[] = [
  { c: 'SOFT', x: 18, y: 30, d: 34, r: -14 },
  { c: 'WET', x: 52, y: 20, d: 32, r: 18 },
  { c: 'MEDIUM', x: 30, y: 58, d: 36, r: 8 },
  { c: 'INTER', x: 66, y: 54, d: 31, r: -22 },
  { c: 'HARD', x: 46, y: 80, d: 33, r: 30 },
];

export default function LaunchCard({
  vp,
  stats,
  sectionRef,
}: {
  vp: Vp;
  stats: LandingStats;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const mobile = vp.w < 820;
  const root = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  const box = useDocBox(root);
  const bind = useCallback(
    (el: HTMLElement | null) => {
      root.current = el;
      sectionRef(el);
    },
    [sectionRef],
  );
  const depth = Math.round(vp.w * (mobile ? 0.14 : 0.1));
  const height = Math.round(mobile ? vp.h * 1.25 : Math.max(vp.h * 1.15, 820));

  useFlowFrame(root, (f) => {
    const top = box.current.top;
    const e = f.reduced ? 1 : easeOut((f.y - (top - f.vh)) / (f.vh * 0.95));
    const p = clamp((f.y - top) / f.vh, -1, 1);
    if (card.current) card.current.style.transform = `translate3d(0, ${((1 - e) * 42).toFixed(2)}vh, 0) rotate(${((1 - e) * -4).toFixed(2)}deg)`;
    if (pile.current && !f.reduced) pile.current.style.transform = `rotate(${(p * 10).toFixed(2)}deg)`;
  });

  const cardH = mobile ? undefined : Math.min(620, vp.h * 0.7);
  return (
    <section ref={bind} data-chapter="launch" className="pointer-events-auto relative z-[2]" style={{ height }}>
      <div
        className="absolute overflow-hidden"
        style={{
          top: -2,
          left: '-25%',
          width: '150%',
          height: height + depth + 2,
          background: C.neon,
          borderRadius: `0 0 50% 50% / 0 0 ${Math.round(depth / 0.255)}px ${Math.round(depth / 0.255)}px`,
        }}
      >
        <div className="fl-paper" style={{ opacity: 0.22 }} />
        <div className="fl-grain" style={{ opacity: 0.1 }} />
      </div>
      <div className="relative flex justify-center px-4" style={{ paddingTop: mobile ? vp.h * 0.1 : vp.h * 0.12 }}>
        <div ref={card} className={`fl-will relative grid w-full max-w-[1200px] ${mobile ? 'grid-cols-1 gap-3' : 'grid-cols-[0.95fr_1fr] gap-6'}`}>
          {/* "photo" squircle: an armful of compounds + the ghost */}
          <div className="fl-squircle relative overflow-hidden" style={{ height: mobile ? vp.w * 0.72 : cardH, background: `linear-gradient(150deg, ${C.lilac}, #8f76ff)`, boxShadow: `-8px 12px 0 #6c55d9` }}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(255,255,255,0.4),transparent_55%)]" />
            <CarTop color="#9aa1aa" ghost className="absolute left-[8%] top-[6%] h-[48%] w-[20%] rotate-[24deg] opacity-80" />
            <div ref={pile} className="fl-will absolute inset-0">
              {PILE.map((d, i) => (
                <div key={i} className="absolute" style={{ left: `${d.x}%`, top: `${d.y}%`, width: `${d.d}%`, aspectRatio: '1', transform: `translate(-30%,-50%) rotate(${d.r}deg)` }}>
                  <CompoundDisc compound={d.c} size="100%" />
                </div>
              ))}
            </div>
          </div>
          {/* tape joining the two cards */}
          {!mobile && <span className="fl-tape z-10" style={{ left: 'calc(47.5% - 46px)', top: '20%', width: 92, height: '52%', transform: 'rotate(1.5deg)' }} />}
          {/* headline card */}
          <div
            className="fl-squircle relative flex flex-col items-center justify-center overflow-hidden px-6 py-10 text-center"
            style={{ minHeight: mobile ? vp.w * 0.95 : cardH, background: C.green, boxShadow: `-8px 12px 0 ${C.greenDeep}` }}
          >
            <h2 className="font-display font-normal uppercase leading-[0.88]" style={{ color: C.neon, fontSize: mobile ? vp.w * 0.14 : Math.min(130, vp.w * 0.085) }}>
              Let&rsquo;s rewrite
              <br />
              the race!
            </h2>
            <p className="mt-4 max-w-sm font-sans text-sm font-semibold sm:text-base" style={{ color: C.neon }}>
              Every lap of the 2026 season, real OpenF1 timing, and a ghost car for the call that never came.
            </p>
            <Link
              to="/replay/silverstone?autoplay=1"
              className="fl-link mt-7 inline-flex items-center gap-3 rounded-full px-7 py-4 font-display text-xl uppercase tracking-wide sm:text-2xl"
              style={{ background: C.neon, color: C.green, boxShadow: `0 4px 0 ${C.greenDeep}` }}
            >
              Launch 3D Race Lab <span aria-hidden>→</span>
            </Link>
            <div className="mt-6 flex flex-wrap justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: C.neon }}>
              <Link to="/circuits" className="rounded-full border px-4 py-2 transition hover:bg-[#D4FF00] hover:text-[#0A3A12]" style={{ borderColor: C.neon }}>
                {stats.ready ? `Circuits · ${stats.racesTotal} rounds →` : 'Circuits →'}
              </Link>
              <Link to="/season" className="rounded-full border px-4 py-2 transition hover:bg-[#D4FF00] hover:text-[#0A3A12]" style={{ borderColor: C.neon }}>
                Season →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
