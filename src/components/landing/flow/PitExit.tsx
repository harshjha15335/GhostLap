import { ArrowUp, Play, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LandingStats } from '../stats';
import CompoundDisc from './CompoundDisc';
import { makeBody, settle, step, type Body, type World } from './physics';
import { ArchWord, type Vp } from './Strategist';
import { C, type CompoundKey } from './theme';

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/circuits', label: 'Circuits' },
  { to: '/replay/silverstone?autoplay=1', label: 'Race Lab' },
  { to: '/season', label: 'Season' },
];

interface Item {
  key: string;
  kind: 'disc' | 'button';
  r: number;
  node: ReactNode;
  label: string;
  action?: () => void;
}

function RoundButton({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-full w-full items-center justify-center rounded-full shadow-[0_10px_18px_rgba(0,0,0,0.3)]" style={{ background: C.pink, color: C.ink }}>
      {children}
    </span>
  );
}

export default function PitExit({
  vp,
  stats,
  reduced,
  sectionRef,
}: {
  vp: Vp;
  stats: LandingStats;
  reduced: boolean;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const mobile = vp.w < 820;
  const navigate = useNavigate();
  const root = useRef<HTMLElement | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLElement | null)[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const bind = useCallback(
    (el: HTMLElement | null) => {
      root.current = el;
      sectionRef(el);
    },
    [sectionRef],
  );

  const depth = Math.round(vp.w * (mobile ? 0.14 : 0.1));
  // at the very end of the page the CTA's curved hem still shows under the top bar
  const height = Math.max(vp.h, mobile ? 700 : 760);
  const rd = mobile ? Math.round(vp.w * 0.155) : Math.round(Math.min(vp.w / 1440, vp.h / 820) * 132);
  const rb = Math.round(rd * (mobile ? 0.72 : 0.66));
  const floorPad = mobile ? 46 : 52;

  const share = useCallback(() => {
    const url = window.location.origin + window.location.pathname;
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) {
      nav.share({ title: 'GhostLap 2026', url }).catch(() => {});
      return;
    }
    navigator.clipboard
      ?.writeText(url)
      .then(() => setToast('Link copied'))
      .catch(() => setToast(url));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const items = useMemo<Item[]>(() => {
    const disc = (c: CompoundKey, extra?: { color?: string; label?: string; ring?: string; letter?: string }): Item => ({
      key: `d-${c}-${extra?.label ?? ''}`,
      kind: 'disc',
      r: rd,
      label: `${c.toLowerCase()} compound`,
      node: <CompoundDisc compound={c} size="100%" {...extra} />,
    });
    const list: Item[] = [
      { key: 'b-lab', kind: 'button', r: rb, label: 'Launch 3D Race Lab', node: <RoundButton><Play size={rb * 0.55} strokeWidth={2.2} /></RoundButton>, action: () => navigate('/replay/silverstone?autoplay=1') },
      disc('SOFT'),
      disc('MEDIUM'),
      { key: 'b-share', kind: 'button', r: rb, label: 'Share GhostLap', node: <RoundButton><Share2 size={rb * 0.5} strokeWidth={2.2} /></RoundButton>, action: share },
      disc('HARD'),
      disc('INTER'),
      { key: 'b-top', kind: 'button', r: rb, label: 'Back to top', node: <RoundButton><ArrowUp size={rb * 0.55} strokeWidth={2.2} /></RoundButton>, action: () => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }) },
      disc('WET'),
    ];
    if (stats.leader) {
      // team-colour variant: the real championship leader
      list.splice(5, 0, disc('SOFT', { color: stats.leader.color, letter: '1', label: `LEADER ${stats.leader.code}`, ring: `CHAMPIONSHIP LEADER · ${stats.leader.code} · ${stats.leader.points} PTS · ` }));
    }
    return list;
  }, [rd, rb, navigate, share, reduced, stats.leader]);

  const world = useRef<World | null>(null);
  const bodies = useRef<Body[]>([]);

  const render = useCallback(() => {
    bodies.current.forEach((b, i) => {
      const el = els.current[i];
      if (el) el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, 0) rotate(${b.a.toFixed(3)}rad)`;
    });
  }, []);

  // (re)build the world when sizes change
  useEffect(() => {
    const W = vp.w;
    const H = height - floorPad;
    const n = items.length;
    const bs = items.map((it, i) => {
      const x = ((i + 0.5) / n) * W + (Math.sin(i * 12.9898) * 0.5) * it.r * 0.6;
      const y = reduced ? H - it.r - (i % 2) * it.r : -it.r * 1.2 - i * it.r * 0.9;
      const b = makeBody(Math.max(it.r, Math.min(W - it.r, x)), y, it.r);
      b.a = (i * 0.9) % 6.28;
      return b;
    });
    world.current = { w: W, h: H, bodies: bs, gravity: mobile ? 2600 : 3000 };
    bodies.current = bs;
    if (reduced) settle(world.current);
    render();
  }, [items, vp.w, height, floorPad, mobile, reduced, render]);

  // loop: starts when the footer is well into view, pauses off-screen and when settled
  const loop = useRef({ raf: 0, visible: false, started: false, calm: 0, last: 0 });
  const kick = useCallback(() => {
    const L = loop.current;
    if (reduced || L.raf || !L.visible || !L.started) return;
    L.last = performance.now();
    L.calm = 0;
    const tick = (now: number) => {
      L.raf = 0;
      const w = world.current;
      if (!w || !L.visible) return;
      const dt = Math.min(1 / 30, (now - L.last) / 1000);
      L.last = now;
      step(w, dt);
      render();
      // resting contacts jitter a few px/s under gravity: treat that as asleep
      const moving = w.bodies.some((b) => b.held || Math.abs(b.vx) + Math.abs(b.vy) > 45 || Math.abs(b.va) > 0.25 || b.y < 0);
      L.calm = moving ? 0 : L.calm + dt;
      if (L.calm < 0.8) L.raf = requestAnimationFrame(tick);
      else w.bodies.forEach((b) => (b.vx = b.vy = b.va = 0));
    };
    L.raf = requestAnimationFrame(tick);
  }, [reduced, render]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const L = loop.current;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          L.visible = e.isIntersecting;
          if (e.intersectionRatio > 0.3) L.started = true;
          if (L.visible) kick();
          else if (L.raf) {
            cancelAnimationFrame(L.raf);
            L.raf = 0;
          }
        });
      },
      { threshold: [0, 0.3, 0.5] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (L.raf) cancelAnimationFrame(L.raf);
      L.raf = 0;
    };
  }, [kick]);

  // drag & toss
  const drag = useRef<{ i: number; id: number; ox: number; oy: number; sx: number; sy: number; t: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const localPt = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (i: number) => (e: React.PointerEvent) => {
    if (reduced || e.button > 0) return;
    const b = bodies.current[i];
    if (!b) return;
    const p = localPt(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { i, id: e.pointerId, ox: b.x - p.x, oy: b.y - p.y, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
    dragged.current = false;
    b.held = true;
    b.tx = b.x;
    b.ty = b.y;
    loop.current.started = true;
    kick();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const b = bodies.current[d.i];
    const p = localPt(e);
    b.tx = p.x + d.ox;
    b.ty = p.y + d.oy;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
      d.moved = true;
      dragged.current = true;
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const b = bodies.current[d.i];
    b.held = false;
    if (!d.moved) {
      // a tap: little hop (buttons still fire their click)
      b.vy = -900 - Math.random() * 300;
      b.va += (Math.random() - 0.5) * 6;
    }
    drag.current = null;
    kick();
  };

  return (
    <footer
      ref={bind}
      data-chapter="pit-exit"
      className="pointer-events-auto relative z-[1] overflow-x-clip"
      style={{ height, background: C.uv, color: C.sun }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="pop-halftone" />
      </div>
      <div className="relative" style={{ paddingTop: depth + (mobile ? 30 : 44) }}>
        <nav aria-label="Footer" className="fl-nav flex items-start justify-between px-4 font-display uppercase sm:px-6" style={{ fontSize: mobile ? 20 : Math.min(40, vp.w * 0.028) }}>
          {NAV.map((n) => (
            <Link key={n.label} to={n.to} className="leading-none transition-transform hover:-translate-y-0.5">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-[4vh] flex flex-col items-center" aria-hidden>
          <div
            className="relative z-[1] -rotate-6 rounded-[50%] border-[3px] px-[1.1em] py-[0.35em] font-display leading-none"
            style={{ borderColor: C.sun, background: C.uvDeep, fontSize: mobile ? 28 : Math.min(54, vp.w * 0.036) }}
          >
            GHOST<span style={{ color: C.cream }}>LAP</span>
          </div>
          <div className="-mt-[0.1em] flex flex-col items-center font-display leading-[1.02]" style={{ fontSize: mobile ? vp.w * 0.25 : Math.min(200, vp.w * 0.13) }}>
            <ArchWord text="REWRITE" color={C.sun} amount={0.16} />
            <ArchWord text="THE RACE" color={C.sun} amount={0.16} />
          </div>
        </div>
      </div>

      {/* physics pile */}
      <div
        ref={layer}
        className="absolute inset-x-0 top-0 z-[2]"
        style={{ height: height - floorPad }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {items.map((it, i) => {
          const common = {
            ref: (el: HTMLElement | null) => {
              els.current[i] = el;
            },
            className: `fl-body fl-will absolute left-0 top-0 ${reduced ? '' : 'cursor-grab active:cursor-grabbing'}`,
            style: { width: it.r * 2, height: it.r * 2, transform: 'translate3d(-999px,-999px,0)' },
            onPointerDown: onDown(i),
          };
          return it.kind === 'button' ? (
            <button
              key={it.key}
              type="button"
              aria-label={it.label}
              title={it.label}
              {...common}
              onClick={() => {
                if (!dragged.current) it.action?.();
              }}
              className={`${common.className} rounded-full focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2`}
            >
              {it.node}
            </button>
          ) : (
            <div key={it.key} aria-hidden {...common}>
              {it.node}
            </div>
          );
        })}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 pb-3 font-mono text-[10px] uppercase tracking-[0.18em] sm:text-[11px]" style={{ color: C.cream }}>
        <span className="rounded-md px-2 py-1" style={{ background: C.ink }}>
          Data: OpenF1 · Not affiliated with Formula 1
        </span>
        {toast && (
          <span className="rounded-md px-2 py-1" style={{ background: C.sun, color: C.ink }} role="status">
            {toast}
          </span>
        )}
      </div>
    </footer>
  );
}
