import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LandingStats } from '../stats';
import CompoundDisc from './CompoundDisc';
import type { FeatureRace } from './featureRace';
import { clamp, useDocBox, useFlowFrame } from './motion';
import { HandArrow, Marker, Note } from './Scribbles';
import { GhostSticker, NeutralSticker, SeasonSticker, Track3DSticker, VerdictSticker } from './Stickers';
import type { Vp } from './Strategist';
import { C, type CompoundKey } from './theme';

interface Floater {
  compound: CompoundKey;
  /** x as a fraction of the row width, y in units of F from the row top */
  fx: number;
  fy: number;
  /** diameter in F */
  d: number;
  /** parallax: extra screen motion relative to the camera (+ = faster) */
  k: number;
  spin: number;
}

interface RowDef {
  n: number;
  verb: string;
  to: string;
  label: string;
  note: string[];
  floaters: Floater[];
}

const ROWS: RowDef[] = [
  {
    n: 1,
    verb: 'REPLAY',
    to: '/replay/silverstone?autoplay=1',
    label: 'Race Lab',
    note: ['box box —', 'watch every car', 'on the real line'],
    floaters: [
      { compound: 'MEDIUM', fx: 0.6, fy: 0.52, d: 0.7, k: 0.22, spin: 0.09 },
      { compound: 'HARD', fx: 0.9, fy: -0.32, d: 0.6, k: -0.12, spin: -0.07 },
    ],
  },
  {
    n: 2,
    verb: 'REWRITE',
    to: '/replay/silverstone?autoplay=1',
    label: 'What If',
    note: ['+0.4s undercut', 'the call nobody', 'made — until now'],
    floaters: [
      { compound: 'SOFT', fx: 0.5, fy: 0.66, d: 0.6, k: 0.18, spin: 0.1 },
      { compound: 'INTER', fx: 0.74, fy: -0.36, d: 0.58, k: -0.16, spin: -0.08 },
    ],
  },
  {
    n: 3,
    verb: 'DEBRIEF',
    to: '/season',
    label: 'Season',
    note: ['stay out!', 'then read the', 'whole season'],
    floaters: [
      { compound: 'WET', fx: 0.5, fy: -0.38, d: 0.62, k: -0.14, spin: 0.08 },
      { compound: 'MEDIUM', fx: 0.86, fy: 0.55, d: 0.66, k: 0.2, spin: -0.1 },
    ],
  },
];

interface Geo {
  F: number;
  H: number;
  rows: { x: number; y: number; w: number }[];
  path: { x: Float32Array; y: Float32Array; s: Float32Array; len: number };
  travel: number;
  focusS: number[];
  arrows: { x: number; y: number; w: number; h: number; bend: number }[];
  head: { y: number; f: number };
}

function catmull(pts: [number, number][], per = 60) {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function computeGeo(vp: Vp, widths: number[]): Geo {
  const mobile = vp.w < 820;
  const F = mobile ? Math.min(vp.h * 0.3, vp.w * 0.6) : Math.max(260, vp.h * 0.48);
  const H = F * 0.86;
  const headF = mobile ? vp.w * 0.105 : Math.min(96, vp.w * 0.058);
  const x1 = mobile ? vp.w * 0.12 : vp.w * 0.1;
  const y1 = mobile ? vp.h * 0.64 : vp.h * 0.74;
  const gap = mobile ? vp.w * 0.3 : vp.w * 0.32;
  const x2 = x1 + widths[0] + gap;
  const y2 = y1 + vp.h * (mobile ? 0.34 : 0.52);
  const x3 = x2 + widths[1] + gap;
  const y3 = y1 - vp.h * 0.02;
  const rows = [
    { x: x1, y: y1, w: widths[0] },
    { x: x2, y: y2, w: widths[1] },
    { x: x3, y: y3, w: widths[2] },
  ];
  const half = vp.w / 2;
  const inset = mobile ? 0.42 : 0.4;
  const focus: [number, number][] = [[half, vp.h / 2]];
  rows.forEach((r, i) => {
    const cy = r.y + H / 2 + (mobile ? 0 : vp.h * 0.04);
    const a = r.x + vp.w * (i === 0 ? (mobile ? 0.5 : 0.62) : inset);
    const b = Math.max(a + 1, r.x + r.w - vp.w * inset);
    focus.push([a, cy], [b, cy]);
  });
  const last = rows[2];
  focus.push([last.x + last.w + vp.w * 0.05, last.y + H / 2 - vp.h * 0.85]);
  const curve = catmull(focus, 80);
  const n = curve.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = curve[i][0];
    y[i] = curve[i][1];
    s[i] = i ? s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) : 0;
  }
  // arc length at each focus waypoint (points sit at multiples of 80 samples)
  const focusS = focus.map((_, i) => s[Math.min(n - 1, i * 80)]);
  const len = s[n - 1];
  const arrows = [
    {
      x: rows[0].x + rows[0].w - F * 0.2,
      y: rows[0].y + H + F * 0.15,
      w: rows[1].x - (rows[0].x + rows[0].w) - F * 0.1,
      h: rows[1].y - rows[0].y - H * 0.55,
      bend: 0.22,
    },
    {
      x: rows[1].x + rows[1].w + F * 0.05,
      y: rows[1].y - F * 0.05,
      w: rows[2].x - (rows[1].x + rows[1].w) - F * 0.7,
      h: rows[2].y - rows[1].y + H * 0.15,
      bend: -0.22,
    },
  ];
  return {
    F,
    H,
    rows,
    path: { x, y, s, len },
    travel: Math.round(len * (mobile ? 0.8 : 0.95)),
    focusS,
    arrows,
    head: { y: mobile ? vp.h * 0.2 : vp.h * 0.26, f: headF },
  };
}

function sampleAt(g: Geo, dist: number, out: { x: number; y: number }) {
  const { x, y, s } = g.path;
  const d = Math.max(0, Math.min(g.path.len, dist));
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (s[m] < d) lo = m;
    else hi = m;
  }
  const t = s[hi] - s[lo] > 0 ? (d - s[lo]) / (s[hi] - s[lo]) : 0;
  out.x = x[lo] + (x[hi] - x[lo]) * t;
  out.y = y[lo] + (y[hi] - y[lo]) * t;
}

export default function EveryLap({
  vp,
  race,
  stats,
  reduced,
  sectionRef,
}: {
  vp: Vp;
  race: FeatureRace | null;
  stats: LandingStats;
  reduced: boolean;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const root = useRef<HTMLElement | null>(null);
  const plane = useRef<HTMLDivElement>(null);
  const rowEls = useRef<(HTMLElement | null)[]>([]);
  const floatEls = useRef<(HTMLElement | null)[]>([]);
  const box = useDocBox(root);
  const [widths, setWidths] = useState<number[] | null>(null);
  const mobile = vp.w < 820;
  const geo = useMemo(() => (widths ? computeGeo(vp, widths) : null), [vp, widths]);
  const F = geo?.F ?? (mobile ? Math.min(vp.h * 0.3, vp.w * 0.6) : Math.max(260, vp.h * 0.48));

  const bind = useCallback(
    (el: HTMLElement | null) => {
      root.current = el;
      sectionRef(el);
    },
    [sectionRef],
  );

  // measure intrinsic row widths (after fonts load too)
  useLayoutEffect(() => {
    if (reduced) return;
    let dead = false;
    const measure = () => {
      if (dead) return;
      const ws = rowEls.current.map((el) => el?.offsetWidth ?? 0);
      if (ws.every((w) => w > 0)) setWidths((o) => (o && o.every((w, i) => Math.abs(w - ws[i]) < 1) ? o : ws));
    };
    measure();
    void document.fonts?.ready.then(measure);
    const t = window.setTimeout(measure, 800);
    return () => {
      dead = true;
      window.clearTimeout(t);
    };
  }, [vp, reduced, F]);

  const cam = useRef({ x: 0, y: 0 });
  useFlowFrame(root, (f) => {
    const g = geo;
    const pl = plane.current;
    if (!g || !pl || f.reduced) return;
    const local = clamp((f.y - box.current.top) / g.travel, 0, 1) * g.travel;
    sampleAt(g, local * (g.path.len / g.travel), cam.current);
    const cx = cam.current.x - f.vw / 2;
    const cy = cam.current.y - f.vh / 2;
    pl.style.transform = `translate3d(${(-cx).toFixed(1)}px, ${(-cy).toFixed(1)}px, 0)`;
    // floaters: extra parallax relative to the moment their row is centred
    let idx = 0;
    ROWS.forEach((row, ri) => {
      const ref = (g.focusS[1 + ri * 2] + g.focusS[2 + ri * 2]) / 2;
      const rel = local * (g.path.len / g.travel) - ref;
      row.floaters.forEach((fl) => {
        const el = floatEls.current[idx++];
        if (!el) return;
        el.style.transform = `translate3d(${(-rel * fl.k).toFixed(1)}px, ${(rel * fl.k * 0.25).toFixed(1)}px, 0) rotate(${(rel * fl.spin).toFixed(1)}deg)`;
      });
    });
  });

  const stickerFor = (n: number): ReactNode => {
    const sz = F * 0.8;
    const wrap = (node: ReactNode, key: string, extra?: ReactNode, w = sz) => (
      <span key={key} className="relative inline-block shrink-0 align-middle" style={{ width: w, height: sz, fontSize: sz / 12 }}>
        {node}
        {extra}
      </span>
    );
    if (n === 1) return wrap(<Track3DSticker race={race} reduced={reduced} />, 's1');
    if (n === 2)
      return (
        <>
          {wrap(
            <GhostSticker race={race} />,
            's2',
            <span className="absolute -bottom-[12%] -right-[30%] z-10" style={{ fontSize: sz / 11 }}>
              <VerdictSticker race={race} />
            </span>,
          )}
        </>
      );
    return (
      <>
        {wrap(<SeasonSticker stats={stats} />, 's3')}
        <span className="-ml-[0.12em] inline-block" style={{ marginTop: F * 0.3 }}>
          {wrap(<NeutralSticker stats={stats} />, 's3b', undefined, sz * 0.72)}
        </span>
      </>
    );
  };

  const staticMode = reduced;
  const height = staticMode || !geo ? undefined : vp.h + geo.travel;
  let fi = 0;

  const headline = (
    <div className="w-max text-center" style={{ color: C.ink }}>
      <span className="fl-pill rotate-[-2deg] px-[0.8em] py-[0.55em] text-[14px]" style={{ background: C.ink, color: C.sun }}>
        Why GhostLap
      </span>
      <h2 className="mt-4 font-display font-normal uppercase leading-[0.9]" style={{ fontSize: geo?.head.f ?? (mobile ? vp.w * 0.105 : Math.min(96, vp.w * 0.058)) }}>
        We&rsquo;re here
        <br />
        for every lap
        <br />
        that matters.
      </h2>
    </div>
  );

  return (
    <section
      ref={bind}
      data-chapter="everylap"
      className="pointer-events-auto relative z-[2]"
      style={{ height: height ?? (staticMode ? undefined : vp.h * 4), background: C.pink }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="pop-halftone" />
      </div>
      {staticMode ? (
        <div className="relative px-4 pb-16" style={{ paddingTop: vp.h * 0.18 }}>
          {headline}
          <div className="mt-12 flex flex-col gap-10">
            {ROWS.map((row) => (
              <Link key={row.n} to={row.to} className="fl-word flex flex-wrap items-center gap-4 font-display leading-[0.85]" style={{ color: C.ink, fontSize: F * 0.42 }}>
                <Marker n={row.n} size={40} />
                <span>TO</span>
                <span className="fl-verb">{row.verb}</span>
                <span className="font-mono text-xs uppercase tracking-[0.18em]">→ {row.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="sticky top-0 h-[100svh] overflow-hidden">
          <div ref={plane} className="fl-will absolute left-0 top-0" style={{ width: 1, height: 1 }}>
            <div className="absolute -translate-x-1/2" style={{ left: vp.w / 2, top: geo?.head.y ?? vp.h * 0.24 }}>
              {headline}
            </div>
            {ROWS.map((row, ri) => {
              const pos = geo?.rows[ri];
              return (
                <Link
                  key={row.n}
                  ref={(el) => {
                    rowEls.current[ri] = el;
                  }}
                  to={row.to}
                  aria-label={`To ${row.verb.toLowerCase()} — open ${row.label}`}
                  className="fl-word absolute flex items-center whitespace-nowrap font-display leading-[0.86]"
                  style={{ left: pos?.x ?? 0, top: pos?.y ?? vp.h, fontSize: F, color: C.ink, gap: F * 0.06, visibility: pos ? 'visible' : 'hidden' }}
                >
                  <Marker n={row.n} size={F * 0.2} className="absolute" style={{ left: -F * 0.32, top: F * 0.02 }} />
                  <span>TO</span>
                  <span className="relative inline-flex items-center" style={{ gap: F * 0.02 }}>
                    {stickerFor(row.n)}
                    <Note lines={row.note} size={Math.max(16, F * 0.075)} style={{ left: -F * 0.28, top: F * 0.98 }} />
                  </span>
                  <span className="fl-verb">{row.verb}</span>
                  <span className="fl-tag pointer-events-none absolute -top-[0.04em] right-0 translate-y-[-100%] rounded-md px-2 py-1 font-mono text-[12px] uppercase tracking-[0.18em]" style={{ background: C.ink, color: C.sun }}>
                    open {row.label} →
                  </span>
                  {row.floaters.map((fl, k) => {
                    const i = fi++;
                    return (
                      <span
                        key={k}
                        className="pointer-events-none absolute"
                        style={{ left: `${fl.fx * 100}%`, top: fl.fy * F, width: fl.d * F, height: fl.d * F, marginLeft: (-fl.d * F) / 2 }}
                      >
                        <span
                          ref={(el) => {
                            floatEls.current[i] = el;
                          }}
                          className="fl-will block h-full w-full"
                        >
                          <CompoundDisc compound={fl.compound} size="100%" />
                        </span>
                      </span>
                    );
                  })}
                </Link>
              );
            })}
            {geo?.arrows.map((a, i) => (
              <div key={i} className="absolute" style={{ left: a.x, top: a.y }}>
                <HandArrow w={a.w} h={a.h} bend={a.bend} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
