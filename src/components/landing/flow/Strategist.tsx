import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CompoundDisc from './CompoundDisc';
import type { FeatureRace } from './featureRace';
import { clamp, easeOut, useDocBox, useFlowFrame } from './motion';
import { TowerSticker, TrackSticker } from './Stickers';
import { C, COMPOUND_STYLE, type CompoundKey } from './theme';

const PILLS = ['Undercut', 'Overcut', 'SC window', 'Tyre cliff'];
const PICKS: CompoundKey[] = ['SOFT', 'MEDIUM', 'HARD', 'INTER', 'WET'];
const BAND_TEXT = 'EVERY LAP · EVERY CALL · EVERY DELTA · ';

export interface Vp {
  w: number;
  h: number;
}

/** Desktop and phone compositions, in px. Desktop is authored at 1440×900. */
function useComposition(vp: Vp) {
  return useMemo(() => {
    const mobile = vp.w < 820;
    const cx = vp.w / 2;
    if (!mobile) {
      const s = Math.min(vp.w / 1440, Math.max(0.72, vp.h / 900));
      const band = Math.round(vp.w * 0.26);
      return {
        mobile,
        s,
        band,
        bandT: Math.round(Math.max(70, vp.w * 0.072)),
        depth: Math.round(vp.w * 0.1),
        height: Math.round(1000 * s + vp.w * 0.05),
        pill: { x: cx, y: 60 * s, f: 15 * s },
        the: { x: cx, y: 100 * s, f: 300 * s },
        disc: { x: cx, y: 395 * s, d: 350 * s },
        word: { x: cx, y: 400 * s, f: 290 * s },
        explore: { x: cx + 210 * s, y: 225 * s, d: 168 * s },
        left: { x: cx - 395 * s, y: 300 * s, d: 222 * s },
        right: { x: cx + 360 * s, y: 380 * s, d: 236 * s },
        pills: { x: 14, y: 270 * s, f: 15 * s, row: false },
        para: { x: 14, y: 470 * s, w: 210 * s, f: 15.5 * s },
        pick: { x: vp.w - 150 * s, y: 190 * s, d: 96 * s, row: false },
      };
    }
    const s = vp.w / 390;
    const band = Math.round(vp.w * 0.5);
    return {
      mobile,
      s,
      band,
      bandT: Math.round(vp.w * 0.13),
      depth: Math.round(vp.w * 0.14),
      height: Math.round(930 * s),
      pill: { x: cx, y: 24 * s, f: 12 * s },
      the: { x: cx, y: 52 * s, f: 140 * s },
      disc: { x: cx, y: 222 * s, d: 196 * s },
      word: { x: cx, y: 238 * s, f: 110 * s },
      explore: { x: cx + 128 * s, y: 128 * s, d: 92 * s },
      left: { x: cx - 92 * s, y: 470 * s, d: 150 * s },
      right: { x: cx + 94 * s, y: 486 * s, d: 150 * s },
      pills: { x: 16, y: 590 * s, f: 13 * s, row: true },
      para: { x: 16, y: 650 * s, w: vp.w - 32, f: 14 * s },
      pick: { x: 16, y: 760 * s, d: 62 * s, row: true },
    };
  }, [vp]);
}

/** Bulging, outward-leaning letters (the reference's warped display word). */
export function ArchWord({ text, color, amount = 0.3, squeeze = 1 }: { text: string; color: string; amount?: number; squeeze?: number }) {
  const n = text.length;
  return (
    <span className="inline-flex items-end whitespace-nowrap" aria-label={text} style={squeeze !== 1 ? { transform: `scaleX(${squeeze})` } : undefined}>
      {text.split('').map((ch, i) => {
        const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
        return (
          <span
            key={i}
            aria-hidden
            className="inline-block"
            style={{
              color,
              whiteSpace: 'pre',
              transformOrigin: '50% 100%',
              transform: `translateY(${((1 - t * t) * amount * 0.17).toFixed(3)}em) rotate(${(t * amount * 16).toFixed(2)}deg) scaleY(${(1 + amount * t * t).toFixed(3)})`,
            }}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}

function ExploreBadge({ size }: { size: number }) {
  const ring = 'EXPLORE THE RACE LAB · LIGHTS OUT · ';
  return (
    <Link
      to="/replay/silverstone?autoplay=1"
      className="fl-link group pointer-events-auto relative block rounded-full bg-white shadow-[0_14px_30px_rgba(0,0,0,0.22)]"
      style={{ width: size, height: size }}
      aria-label="Explore the 3D Race Lab"
    >
      <svg viewBox="0 0 200 200" className="fl-spin absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <path id="fl-explore-ring" d="M100,100 m-84,0 a84,84 0 1,1 168,0 a84,84 0 1,1 -168,0" />
        </defs>
        <circle cx="100" cy="100" r="93" fill="none" stroke={C.ink} strokeWidth="2.4" strokeDasharray="0.1 6.5" strokeLinecap="round" />
        <text fontFamily="Anton, Impact, sans-serif" fontSize="12" letterSpacing="3" fill={C.ink}>
          <textPath href="#fl-explore-ring" textLength={522} lengthAdjust="spacing">
            {ring}
            {ring}
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-0 flex -rotate-[8deg] flex-col items-center justify-center">
        <span className="font-display leading-none" style={{ color: C.blue, fontSize: size * 0.2 }}>
          EXPLORE
        </span>
        <span
          className="mt-[4%] flex items-center justify-center rounded-full transition-transform group-hover:scale-125"
          style={{ width: size * 0.17, height: size * 0.17, background: C.pink, color: C.ink, fontSize: size * 0.1 }}
        >
          ↗
        </span>
      </div>
    </Link>
  );
}

/** centre line of the tape band (px, in the band's own box) */
const bandY = (x: number, w: number, h: number) => h * (0.68 - 0.36 * (x / w)) + h * 0.07 * Math.sin(((2 * Math.PI) / w) * x * 1.1 + 0.5);

/** Hot-magenta band riding the ultramarine section's wavy top edge. */
function TapeBand({ w, h, t, textRef }: { w: number; h: number; t: number; textRef: (el: SVGTextPathElement | null) => void }) {
  const line = useMemo(() => {
    const pts: string[] = [];
    for (let x = -w * 0.6; x <= w * 1.25; x += w / 60) pts.push(`${x.toFixed(1)} ${bandY(x, w, h).toFixed(1)}`);
    return `M${pts.join(' L')}`;
  }, [w, h]);
  return (
    <svg className="pointer-events-none absolute left-0 w-full" style={{ top: -h, height: h + 2 }} viewBox={`0 0 ${w} ${h + 2}`} aria-hidden>
      <defs>
        <path id="fl-band-line" d={line} />
      </defs>
      <path d={line} fill="none" stroke="rgba(23,15,51,0.3)" strokeWidth={t} transform="translate(-6 9)" />
      <path d={line} fill="none" stroke={C.pink} strokeWidth={t} />
      <text fontFamily="Anton, Impact, sans-serif" fontSize={t * 0.62} letterSpacing={t * 0.04} fill={C.ink} dominantBaseline="central">
        <textPath ref={textRef} href="#fl-band-line" startOffset="0">
          {BAND_TEXT.repeat(8)}
        </textPath>
      </text>
    </svg>
  );
}

export default function Strategist({
  vp,
  race,
  reduced,
  sectionRef,
}: {
  vp: Vp;
  race: FeatureRace | null;
  reduced: boolean;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const L = useComposition(vp);
  const root = useRef<HTMLElement | null>(null);
  const box = useDocBox(root);
  const [compound, setCompound] = useState<CompoundKey>('SOFT');
  const r = useRef<Record<string, HTMLElement | SVGTextPathElement | null>>({});
  const set = (k: string) => (el: HTMLElement | SVGTextPathElement | null) => {
    r.current[k] = el;
  };
  const bind = useCallback(
    (el: HTMLElement | null) => {
      root.current = el;
      sectionRef(el);
    },
    [sectionRef],
  );

  useFlowFrame(root, (f) => {
    const { top, height } = box.current;
    // 0 when the section top is at the viewport bottom, 1 when its bottom leaves the top
    const p = clamp((f.y - (top - f.vh)) / (f.vh + height));
    const enter = easeOut((f.y - (top - f.vh)) / (f.vh * 0.9));
    const k = f.reduced ? 0 : 1;
    const s = L.s;
    const tf = (key: string, v: string) => {
      const el = r.current[key] as HTMLElement | null;
      if (el) el.style.transform = v;
    };
    const band = r.current.band as SVGTextPathElement | null;
    if (band) band.setAttribute('startOffset', String(-((f.y * 0.55) % 4000) - 400));
    tf('the', `translate3d(-50%, ${(k * (1 - enter) * 160 * s + k * (p - 0.5) * -60 * s).toFixed(1)}px, 0)`);
    tf('word', `translate3d(-50%, ${(k * (1 - enter) * 220 * s + k * (p - 0.5) * -30 * s).toFixed(1)}px, 0)`);
    tf('disc', `translate3d(-50%, -50%, 0) rotate(${(k * f.y * 0.12).toFixed(1)}deg) scale(${(0.7 + 0.3 * (k ? enter : 1)).toFixed(3)})`);
    tf('left', `translate3d(-50%, ${(-50 + k * (0.5 - p) * 70).toFixed(1)}%, 0) rotate(${(k * (p - 0.5) * 10).toFixed(2)}deg)`);
    tf('right', `translate3d(-50%, ${(-50 + k * (0.5 - p) * 110).toFixed(1)}%, 0) rotate(${(k * (0.5 - p) * 12).toFixed(2)}deg)`);
    tf('explore', `translate3d(-50%, ${(-50 + k * (0.5 - p) * 60).toFixed(1)}%, 0) scale(${(0.6 + 0.4 * (k ? enter : 1)).toFixed(3)})`);
    tf('pick', `translate3d(0, ${(k * (0.5 - p) * 90 * s).toFixed(1)}px, 0)`);
  });

  const discSize = L.disc.d;
  // the ultramarine body reaches up behind the tape band, clipped to the band's wave
  const waveClip = useMemo(() => {
    const off = vp.w * 0.25;
    const pts: string[] = [];
    for (let x = -10; x <= vp.w + 10; x += vp.w / 60) pts.push(`${(x + off).toFixed(1)}px ${(bandY(x, vp.w, L.band) + L.bandT * 0.4).toFixed(1)}px`);
    const y0 = (bandY(0, vp.w, L.band) + L.bandT * 0.4).toFixed(1);
    const y1 = (bandY(vp.w, vp.w, L.band) + L.bandT * 0.4).toFixed(1);
    return `polygon(0px ${y0}px, ${pts.join(', ')}, 100% ${y1}px, 100% 100%, 0px 100%)`;
  }, [vp.w, L.band, L.bandT]);

  return (
    <section ref={bind} data-chapter="strategist" className="pointer-events-auto relative z-[3]" style={{ height: L.height, color: C.sun }}>
      {/* ultramarine body with a bulging lower edge that overlaps the next section */}
      <div
        className="absolute overflow-hidden"
        style={{
          top: -L.band,
          left: '-25%',
          width: '150%',
          height: L.height + L.band + L.depth,
          background: C.blue,
          borderRadius: `0 0 50% 50% / 0 0 ${Math.round(L.depth / 0.255)}px ${Math.round(L.depth / 0.255)}px`,
          clipPath: waveClip,
        }}
      >
        <div className="pop-halftone" />
      </div>
      <TapeBand w={vp.w} h={L.band} t={L.bandT} textRef={set('band')} />

      <div className="absolute inset-0">
        {/* pill */}
        <div className="absolute z-[1] -translate-x-1/2" style={{ left: L.pill.x, top: L.pill.y }}>
          <span className="fl-pill -rotate-2 px-[0.8em] py-[0.55em]" style={{ background: C.sun, color: C.blueDeep, fontSize: L.pill.f }}>
            Meet the one who makes the call
          </span>
        </div>
        {/* THE */}
        <div ref={set('the')} className="fl-will absolute font-display leading-[0.8]" style={{ left: L.the.x, top: L.the.y, fontSize: L.the.f, transform: 'translateX(-50%)' }}>
          <ArchWord text="THE" color={C.sun} amount={0} />
        </div>
        {/* STRATEGIST */}
        <h2 ref={set('word')} className="fl-will absolute font-display font-normal leading-[0.8]" style={{ left: L.word.x, top: L.word.y, fontSize: L.word.f, transform: 'translateX(-50%)' }}>
          <span className="sr-only">The strategist</span>
          <ArchWord text="STRATEGIST" color={C.sun} amount={0.24} squeeze={L.mobile ? 0.62 : 0.74} />
        </h2>
        {/* central compound disc */}
        <div ref={set('disc')} className="fl-will absolute" style={{ left: L.disc.x, top: L.disc.y, width: discSize, height: discSize, transform: 'translate(-50%,-50%)' }}>
          <div className="absolute inset-[-7%] rounded-full" style={{ background: 'rgba(255,212,0,0.45)' }} />
          <CompoundDisc key={compound} compound={compound} size="100%" className="relative" />
        </div>
        {/* explore badge */}
        <div ref={set('explore')} className="fl-will absolute" style={{ left: L.explore.x, top: L.explore.y, transform: 'translate(-50%,-50%)' }}>
          <ExploreBadge size={L.explore.d} />
        </div>
        {/* stickers */}
        <div ref={set('left')} className="fl-will absolute" style={{ left: L.left.x, top: L.left.y, width: L.left.d, height: L.left.d, fontSize: L.left.d / 12, transform: 'translate(-50%,-50%)' }}>
          <TrackSticker race={race} reduced={reduced} />
        </div>
        <div ref={set('right')} className="fl-will absolute" style={{ left: L.right.x, top: L.right.y, width: L.right.d, height: L.right.d, fontSize: L.right.d / 12, transform: 'translate(-50%,-50%)' }}>
          <TowerSticker race={race} />
        </div>
        {/* category pills */}
        <ul className={`absolute flex ${L.pills.row ? 'flex-row flex-wrap gap-2 pr-4' : 'flex-col gap-3'}`} style={{ left: L.pills.x, top: L.pills.y }}>
          {PILLS.map((p, i) => (
            <li key={p}>
              <span className="fl-pill px-[0.75em] py-[0.6em]" style={{ background: C.sun, color: C.blueDeep, fontSize: L.pills.f, transform: `rotate(${i % 2 ? 1 : -1}deg)` }}>
                {p}
              </span>
            </li>
          ))}
        </ul>
        <p className="absolute font-sans font-medium leading-[1.35]" style={{ left: L.para.x, top: L.para.y, width: L.para.w, fontSize: L.para.f, color: C.cream }}>
          Always reading the gaps, the tyre age and the pit window. Calls the undercut, the overcut and the safety-car gamble. Calm on the radio. No panic.
        </p>
        {/* compound picker (the reference's "roll it!" column) */}
        <div ref={set('pick')} className="fl-will absolute" style={{ left: L.pick.x, top: L.pick.y }}>
          <div className={`fl-hand mb-1 ${L.pick.row ? '' : '-ml-14 -rotate-12'} text-[22px] font-bold leading-none`} style={{ color: C.sun }}>
            pick a compound!
          </div>
          <div className={`flex ${L.pick.row ? 'flex-row gap-1.5' : 'flex-col gap-1'}`}>
            {PICKS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCompound(c)}
                aria-pressed={compound === c}
                aria-label={`Show ${c.toLowerCase()} compound`}
                className="rounded-full transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ outlineColor: C.sun, transform: compound === c ? 'scale(1.08)' : undefined }}
              >
                <CompoundDisc compound={c} size={L.pick.d} />
              </button>
            ))}
          </div>
          <div className="mt-1 max-w-[150px] font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: C.sun }}>
            {COMPOUND_STYLE[compound].tagline}
          </div>
        </div>
      </div>
    </section>
  );
}
