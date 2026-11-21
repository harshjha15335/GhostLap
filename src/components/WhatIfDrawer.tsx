import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Minus, Play, Plus, RotateCcw, Sparkles, X, Zap } from 'lucide-react';
import type { Compound, GhostResult, RaceBundle, WhatIfPreset, WhatIfScenario } from '@/types';
import { MODEL, computePresets } from '@/engine/strategySimulator';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import { COMPOUND_COLORS } from '@/components/three/F1Car';
import { useRaceLab } from '@/store/raceLabStore';
import { useDriverLookup } from '@/store/seasonStore';
import { launchScenario } from '@/components/replay/lib/frame';
import { encodeScenario, shareUrl } from '@/components/replay/lib/shareCodec';
import { COMPOUND_SHORT, fmtDelta, realStopsFrom } from '@/components/replay/lib/raceMath';

/* ------------------------------------------------------------------ */
/* Draft model: each stop is "real lap + offset" so sliders read −8…+12 */
/* ------------------------------------------------------------------ */

interface DraftStop {
  id: number;
  base: number;
  offset: number;
  compound: Compound;
  real: boolean;
}
interface Draft {
  driver: number;
  fromLap: number;
  stops: DraftStop[];
  avoidPenalties: boolean;
}

let stopId = 1;
const EDIT_COMPOUNDS: { c: Compound; label: string }[] = [
  { c: 'SOFT', label: 'SOFT' },
  { c: 'MEDIUM', label: 'MED' },
  { c: 'HARD', label: 'HARD' },
  { c: 'INTERMEDIATE', label: 'INTER' },
];

function draftFrom(bundle: RaceBundle, sc: WhatIfScenario): Draft {
  const real = realStopsFrom(bundle, sc.driverNumber, sc.fromLap);
  const sorted = [...sc.stops].sort((a, b) => a.lap - b.lap);
  return {
    driver: sc.driverNumber,
    fromLap: sc.fromLap,
    avoidPenalties: sc.avoidPenalties,
    stops: sorted.map((s, i) => ({
      id: stopId++,
      base: real[i]?.lap ?? s.lap,
      offset: s.lap - (real[i]?.lap ?? s.lap),
      compound: s.compound,
      real: !!real[i],
    })),
  };
}

function freshDraft(bundle: RaceBundle, driver: number, fromLap: number, avoidPenalties = false): Draft {
  return {
    driver,
    fromLap,
    avoidPenalties,
    stops: realStopsFrom(bundle, driver, fromLap).map((s) => ({ id: stopId++, base: s.lap, offset: 0, compound: s.compound, real: true })),
  };
}

function toScenario(d: Draft, totalLaps: number): WhatIfScenario {
  const byLap = new Map<number, Compound>();
  for (const s of d.stops) {
    const lap = Math.max(d.fromLap, Math.min(totalLaps - 1, s.base + s.offset));
    byLap.set(lap, s.compound);
  }
  const stops = [...byLap.entries()].sort((a, b) => a[0] - b[0]).map(([lap, compound]) => ({ lap, compound }));
  return { driverNumber: d.driver, fromLap: d.fromLap, stops, avoidPenalties: d.avoidPenalties };
}

function stopRange(s: DraftStop, d: Draft, totalLaps: number): [number, number] {
  const lo = Math.max(s.real ? MODEL.minPitDelta : -(s.base - d.fromLap), d.fromLap - s.base);
  const hi = Math.min(s.real ? MODEL.maxPitDelta : totalLaps - 1 - s.base, totalLaps - 1 - s.base);
  return [Math.min(lo, s.offset), Math.max(hi, s.offset)];
}

/* ------------------------------------------------------------------ */

export default function WhatIfDrawer() {
  const open = useRaceLab((s) => s.drawerOpen);
  const setOpen = useRaceLab((s) => s.setDrawerOpen);
  const bundle = useRaceLab((s) => s.bundle);
  const timeline = useRaceLab((s) => s.timeline);
  const ghost = useRaceLab((s) => s.ghost);
  const scenario = useRaceLab((s) => s.scenario);
  const slug = useRaceLab((s) => s.slug);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <aside
      aria-label="What If? strategy simulator"
      aria-hidden={!open}
      className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[80dvh] flex-col rounded-t-2xl border border-line bg-asphalt/95 shadow-[0_-20px_60px_rgba(0,0,0,.6)] backdrop-blur-md transition-[transform,visibility] duration-300 ease-out
        md:inset-x-auto md:bottom-0 md:right-0 md:top-12 md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-xl md:border-r-0
        ${open ? 'visible translate-y-0 md:translate-x-0' : 'invisible translate-y-full md:translate-x-full md:translate-y-0'}`}
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 md:hidden" />
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Sparkles size={18} className="text-ghost" />
        <div className="flex-1">
          <h2 className="font-display text-xl leading-none tracking-wide text-white">
            WHAT IF<span className="text-ghost">?</span>
          </h2>
          <p className="font-mono text-[10px] text-white/45">Ghost Car strategy simulator</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-white/60 hover:bg-white/5 hover:text-white"
          aria-label="Close What If drawer"
        >
          <X size={18} />
        </button>
      </header>
      {bundle && timeline ? (
        <div className="scrollbar-thin flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
          <Presets bundle={bundle} scenario={scenario} />
          {ghost && <VerdictCard bundle={bundle} timeline={timeline} ghost={ghost} slug={slug ?? bundle.summary.slug} />}
          <ManualControls bundle={bundle} open={open} />
        </div>
      ) : (
        <div className="p-6 font-mono text-sm text-white/50">Loading race…</div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function Presets({ bundle, scenario }: { bundle: RaceBundle; scenario: WhatIfScenario | null }) {
  const [presets, setPresets] = useState<WhatIfPreset[] | null>(null);
  const lookup = useDriverLookup();

  useEffect(() => {
    setPresets(null);
    const id = window.setTimeout(() => {
      try {
        setPresets(computePresets(bundle).slice(0, 2));
      } catch (e) {
        console.warn('computePresets failed', e);
        setPresets([]);
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [bundle]);

  const activeCode = scenario ? encodeScenario(scenario) : null;
  const ready = presets && presets.length > 0;

  return (
    <section className="mb-4" aria-label="One-tap scenarios">
      <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
        <Zap size={12} className="text-neon" /> One-tap scenarios
      </h3>
      <div className="grid gap-2">
        {ready
          ? presets.map((p) => {
              const g = p.expected.positionsGained;
              const active = activeCode === encodeScenario(p.scenario);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => launchScenario(p.scenario)}
                  className={`group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active ? 'border-ghost bg-ghost/10' : 'border-line bg-panel hover:border-ghost/60'
                  }`}
                >
                  <span className="h-9 w-1 shrink-0 rounded-sm" style={{ background: lookup.color(p.scenario.driverNumber) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-tight text-white">{p.label}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-white/50">
                      {lookup.code(p.scenario.driverNumber)} · {p.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block font-display text-lg leading-none ${g > 0 ? 'text-neon' : g < 0 ? 'text-crimson' : 'text-white/70'}`}
                    >
                      {g > 0 ? `+${g}` : g < 0 ? `${g}` : '±0'} POS
                    </span>
                    <span className="font-mono text-[10px] text-white/50">
                      P{p.expected.realFinishPosition ?? '–'}→P{p.expected.ghostFinishPosition} · {fmtDelta(p.expected.deltaSeconds)}
                    </span>
                  </span>
                </button>
              );
            })
          : [0, 1].map((i) => (
              <button
                key={i}
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-dashed border-line bg-panel/50 p-3 text-left"
              >
                <span className="h-9 w-1 rounded-sm bg-white/10" />
                <span className="flex-1">
                  <span className="block h-3 w-3/4 animate-pulse rounded bg-white/10" />
                  <span className="mt-1.5 block h-2 w-1/2 animate-pulse rounded bg-white/5" />
                </span>
                <span className="font-mono text-[10px] text-white/30">{presets === null ? 'computing…' : 'coming soon'}</span>
              </button>
            ))}
      </div>
      {presets && presets.length === 0 && (
        <p className="mt-1.5 font-mono text-[10px] text-white/35">Strategy engine presets aren’t available for this race yet — build your own below.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ManualControls({ bundle, open }: { bundle: RaceBundle; open: boolean }) {
  const lookup = useDriverLookup();
  const runScenario = useRaceLab((s) => s.runScenario);
  const clearGhost = useRaceLab((s) => s.clearGhost);
  const storeScenario = useRaceLab((s) => s.scenario);
  const ghost = useRaceLab((s) => s.ghost);
  const total = bundle.totalLaps;
  const [draft, setDraft] = useState<Draft | null>(null);
  const dirty = useRef(false);
  const lastRun = useRef<WhatIfScenario | null>(null);

  // initialise / follow external scenario changes (presets, share links)
  useEffect(() => {
    if (storeScenario && storeScenario !== lastRun.current) {
      setDraft(draftFrom(bundle, storeScenario));
      dirty.current = false;
    } else if (!storeScenario && open) {
      const s = useRaceLab.getState();
      const lap = s.timeline ? Math.min(total - 1, Math.max(1, s.timeline.leaderLapAt(s.time))) : 1;
      const dn = s.focusDriver ?? bundle.cars[0].driverNumber;
      setDraft((d) => (d && d.driver === dn ? d : freshDraft(bundle, dn, lap)));
      dirty.current = false;
    }
  }, [storeScenario, bundle, open, total]);

  // debounced synchronous recompute
  useEffect(() => {
    if (!draft || !dirty.current) return;
    const id = window.setTimeout(() => {
      const sc = toScenario(draft, total);
      lastRun.current = sc;
      runScenario(sc);
      useRaceLab.getState().setFocusDriver(sc.driverNumber);
    }, 140);
    return () => window.clearTimeout(id);
  }, [draft, total, runScenario]);

  const drivers = useMemo(
    () =>
      [...bundle.cars].sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99) || a.driverNumber - b.driverNumber),
    [bundle],
  );

  if (!draft) return null;

  const update = (fn: (d: Draft) => Draft) => {
    dirty.current = true;
    setDraft((d) => (d ? fn(d) : d));
  };
  const penalties = bundle.events.filter((e) => e.type === 'PENALTY' && e.driverNumber === draft.driver).length;
  const sc = toScenario(draft, total);

  return (
    <section aria-label="Build your own scenario" className="mt-1">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">Build your own</h3>

      <label className="mb-3 block">
        <span className="mb-1 block font-mono text-[10px] text-white/50">DRIVER</span>
        <select
          value={draft.driver}
          onChange={(e) => {
            const dn = Number(e.target.value);
            update((d) => freshDraft(bundle, dn, d.fromLap, d.avoidPenalties));
          }}
          className="h-10 w-full rounded-md border border-line bg-panel px-2 text-sm text-white focus:border-ghost focus:outline-none"
        >
          {drivers.map((c) => {
            const d = lookup.driver(c.driverNumber);
            return (
              <option key={c.driverNumber} value={c.driverNumber}>
                {c.finishPosition ? `P${c.finishPosition}` : c.status} · {lookup.code(c.driverNumber)} · {d?.fullName ?? `Car ${c.driverNumber}`}
              </option>
            );
          })}
        </select>
      </label>

      <label className="mb-3 block">
        <span className="mb-1 flex justify-between font-mono text-[10px] text-white/50">
          <span>PAUSE LAP L0 · reality until here</span>
          <span className="text-ghost">LAP {draft.fromLap}</span>
        </span>
        <input
          type="range"
          min={1}
          max={total - 1}
          value={draft.fromLap}
          onChange={(e) => {
            const L0 = Number(e.target.value);
            update((d) => freshDraft(bundle, d.driver, L0, d.avoidPenalties));
          }}
          className="h-6 w-full accent-[#00F5D4]"
        />
      </label>

      <div className="mb-2 font-mono text-[10px] text-white/50">PIT STOPS FROM LAP {draft.fromLap}</div>
      <ol className="space-y-2">
        {draft.stops.map((s, i) => {
          const [lo, hi] = stopRange(s, draft, total);
          const lap = Math.max(draft.fromLap, Math.min(total - 1, s.base + s.offset));
          return (
            <li key={s.id} className="rounded-md border border-line bg-panel p-2.5">
              <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
                <span className="text-white/50">STOP {i + 1}</span>
                <span className="text-white">LAP {lap}</span>
                {s.real && (
                  <span className={s.offset === 0 ? 'text-white/40' : s.offset < 0 ? 'text-ghost' : 'text-amber'}>
                    {s.offset === 0 ? '(real)' : `${s.offset > 0 ? '+' : ''}${s.offset} vs real L${s.base}`}
                  </span>
                )}
                {!s.real && <span className="text-ghost">(added)</span>}
                <button
                  type="button"
                  onClick={() => update((d) => ({ ...d, stops: d.stops.filter((x) => x.id !== s.id) }))}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded text-white/50 hover:bg-white/5 hover:text-crimson"
                  aria-label={`Remove stop ${i + 1}`}
                >
                  <Minus size={14} />
                </button>
              </div>
              <input
                type="range"
                min={lo}
                max={hi}
                value={s.offset}
                onChange={(e) => {
                  const offset = Number(e.target.value);
                  update((d) => ({ ...d, stops: d.stops.map((x) => (x.id === s.id ? { ...x, offset } : x)) }));
                }}
                className="h-6 w-full accent-[#00F5D4]"
                aria-label={`Stop ${i + 1} lap offset`}
              />
              <div className="mt-1 grid grid-cols-4 gap-1">
                {EDIT_COMPOUNDS.map(({ c, label }) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => update((d) => ({ ...d, stops: d.stops.map((x) => (x.id === s.id ? { ...x, compound: c } : x)) }))}
                    className={`flex h-8 items-center justify-center gap-1 rounded border font-mono text-[10px] ${
                      s.compound === c ? 'bg-white/10 text-white' : 'border-line text-white/50 hover:text-white'
                    }`}
                    style={s.compound === c ? { borderColor: COMPOUND_COLORS[c] } : undefined}
                    aria-pressed={s.compound === c}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: COMPOUND_COLORS[c] }} />
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
        {draft.stops.length === 0 && (
          <li className="rounded-md border border-dashed border-line p-2.5 font-mono text-[11px] text-white/40">
            No stops after lap {draft.fromLap} — the ghost runs to the flag on its current tyres.
          </li>
        )}
      </ol>
      <button
        type="button"
        disabled={draft.stops.length >= 4}
        onClick={() =>
          update((d) => {
            const lastLap = d.stops.length ? Math.max(...d.stops.map((x) => x.base + x.offset)) : d.fromLap;
            const base = Math.min(total - 2, Math.max(d.fromLap + 1, Math.round((lastLap + total) / 2)));
            return { ...d, stops: [...d.stops, { id: stopId++, base, offset: 0, compound: 'HARD', real: false }] };
          })
        }
        className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-ghost/40 font-mono text-[11px] text-ghost hover:bg-ghost/10 disabled:opacity-40"
      >
        <Plus size={14} /> ADD STOP
      </button>

      <label className="mt-3 flex cursor-pointer items-center justify-between rounded-md border border-line bg-panel px-3 py-2.5">
        <span>
          <span className="block text-[13px] text-white">Avoid penalties</span>
          <span className="font-mono text-[10px] text-white/45">
            {penalties ? `${penalties} penalty event${penalties > 1 ? 's' : ''} for ${lookup.code(draft.driver)}` : 'No penalties served'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={draft.avoidPenalties}
          onChange={(e) => update((d) => ({ ...d, avoidPenalties: e.target.checked }))}
          className="peer sr-only"
        />
        <span className="relative h-6 w-11 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white/70 after:transition-transform peer-checked:bg-ghost/70 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ghost" />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            lastRun.current = sc;
            launchScenario(sc);
          }}
          className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-ghost font-mono text-[11px] font-bold text-asphalt hover:brightness-110"
        >
          <Play size={14} fill="currentColor" /> {ghost ? 'REPLAY THE CHANGE' : 'LAUNCH GHOST'}
        </button>
        <button
          type="button"
          onClick={() => {
            clearGhost();
            lastRun.current = null;
            const s = useRaceLab.getState();
            const lap = s.timeline ? Math.min(total - 1, Math.max(1, s.timeline.leaderLapAt(s.time))) : 1;
            dirty.current = false;
            setDraft(freshDraft(bundle, draft.driver, lap));
          }}
          className="flex h-10 items-center justify-center gap-1.5 rounded-md border border-line font-mono text-[11px] text-white/70 hover:text-white"
        >
          <RotateCcw size={14} /> RESET
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function VerdictCard({ bundle, timeline, ghost, slug }: { bundle: RaceBundle; timeline: RaceTimeline; ghost: GhostResult; slug: string }) {
  const lookup = useDriverLookup();
  const [copied, setCopied] = useState(false);
  const dn = ghost.scenario.driverNumber;
  const d = lookup.driver(dn);
  const team = d ? lookup.team(d.teamId) : undefined;
  const color = lookup.color(dn);
  const g = ghost.positionsGained;

  // real running position at the end of each lap, for the battle sparkline
  const realPos = useMemo(() => {
    const out: number[] = [];
    for (let l = 1; l <= timeline.totalLaps; l++) {
      const t = l >= timeline.totalLaps ? timeline.duration - 1 : timeline.timeAtLap(l + 1);
      const st = timeline.statesAt(t).find((s) => s.driverNumber === dn);
      if (!st || st.retired) break;
      out.push(st.position);
    }
    return out;
  }, [timeline, dn]);

  const copy = async () => {
    const url = shareUrl(slug, ghost.scenario);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const keyOvertakes = [...ghost.overtakes].sort((a, b) => Number(b.gained) - Number(a.gained) || a.lap - b.lap).slice(0, 4);
  const n = Math.max(realPos.length, ghost.positionByLap.length);
  const maxP = Math.max(6, ...realPos, ...ghost.positionByLap) + 0.5;
  const W = 320;
  const H = 64;
  const path = (arr: number[]) =>
    arr.map((p, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, n - 1)) * W).toFixed(1)},${((p / maxP) * H).toFixed(1)}`).join('');
  const fromX = ((ghost.scenario.fromLap - 1) / Math.max(1, n - 1)) * W;

  return (
    <section
      aria-label="Verdict"
      className="relative mb-5 overflow-hidden rounded-xl border border-ghost/40 p-4 shadow-[0_0_40px_rgba(0,245,212,.12)]"
      style={{
        background:
          'radial-gradient(120% 80% at 100% 0%, rgba(0,245,212,.18), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(212,255,0,.07), transparent 60%), #0B0E14',
      }}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
        <span className="rounded-sm bg-ghost px-1 font-bold text-asphalt">VERDICT</span>
        <span className="truncate">
          {bundle.summary.name} · R{String(bundle.summary.round).padStart(2, '0')}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="h-10 w-1.5 rounded-sm" style={{ background: color }} />
        <div className="min-w-0">
          <div className="font-display text-2xl leading-none tracking-wide text-white">{d?.lastName?.toUpperCase() ?? lookup.code(dn)}</div>
          <div className="truncate font-mono text-[10px] text-white/50">{team?.name ?? ''} · ghost strategy</div>
        </div>
        <div
          className={`ml-auto rounded-md px-2 py-1 font-display text-xl leading-none ${
            g > 0 ? 'bg-neon text-asphalt' : g < 0 ? 'bg-crimson text-white' : 'bg-white/10 text-white'
          }`}
        >
          {g > 0 ? `+${g}` : g < 0 ? g : '±0'} POS
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 items-end gap-2">
        <div>
          <div className="font-mono text-[10px] text-white/45">REALITY</div>
          <div className="font-display text-4xl leading-none text-white/80">P{ghost.realFinishPosition ?? '–'}</div>
        </div>
        <div className="pb-1 text-center font-display text-2xl text-white/30">→</div>
        <div className="text-right">
          <div className="font-mono text-[10px] text-ghost">GHOST</div>
          <div className="font-display text-4xl leading-none text-ghost drop-shadow-[0_0_14px_rgba(0,245,212,.7)]">P{ghost.ghostFinishPosition}</div>
        </div>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px]">
        <span className="text-white/50">race time delta</span>
        <span className={ghost.deltaSeconds < 0 ? 'text-ghost' : ghost.deltaSeconds > 0 ? 'text-amber' : 'text-white/70'}>
          {fmtDelta(ghost.deltaSeconds)}
        </span>
      </div>

      {/* position battle */}
      <svg viewBox={`0 -4 ${W} ${H + 8}`} className="mt-3 h-16 w-full" preserveAspectRatio="none" aria-label="Running position: reality vs ghost">
        <rect x={fromX} y={-4} width={W - fromX} height={H + 8} fill="rgba(0,245,212,.06)" />
        <path d={path(realPos)} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={path(ghost.positionByLap)} fill="none" stroke="#00F5D4" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-white/35">
        <span>L1</span>
        <span>
          <span className="text-white/60">— reality</span> <span className="text-ghost">— ghost</span> · from L{ghost.scenario.fromLap}
        </span>
        <span>L{timeline.totalLaps}</span>
      </div>

      {keyOvertakes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {keyOvertakes.map((o, i) => (
            <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-8 text-white/40">L{o.lap}</span>
              <span className={o.gained ? 'text-neon' : 'text-crimson'}>{o.gained ? '▲ passes' : '▼ passed by'}</span>
              <span className="h-3 w-[3px] rounded-sm" style={{ background: lookup.color(o.driverNumber) }} />
              <span className="text-white">{lookup.code(o.driverNumber)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-l-2 border-ghost pl-2 text-[13px] font-medium leading-snug text-white">{ghost.verdict}</p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-ghost/50 font-mono text-[11px] text-ghost hover:bg-ghost/10"
        >
          {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? 'LINK COPIED' : 'COPY SHARE LINK'}
        </button>
        <span className="font-display text-sm tracking-wider text-neon/70">GHOSTLAP</span>
      </div>
      <div className="mt-1 truncate font-mono text-[9px] text-white/25">
        {ghost.scenario.stops.map((s) => `L${s.lap} ${COMPOUND_SHORT[s.compound]}`).join(' · ') || 'no stops'}
        {ghost.scenario.avoidPenalties ? ' · no penalties' : ''}
      </div>
    </section>
  );
}
