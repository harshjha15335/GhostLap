import { useEffect, useMemo, useState } from 'react';
import { circuitSvgPath, circuitSvgStart } from '@/data/circuits';
import { loadRace } from '@/engine/dataLoader';
import { DEFAULT_RACE_SLUG, type RaceBundle, type SeasonData, type WhatIfPreset } from '@/types';

export interface TowerRow {
  pos: number;
  code: string;
  color: string;
  gap: string;
}

export interface FeatureRace {
  slug: string;
  name: string;
  circuitName: string;
  round: number;
  laps: number | null;
  /** closed SVG path in a 0..100 box */
  outline: string;
  start: [number, number];
  tower: TowerRow[];
  /** best computed undercut-style preset, or null if none / still computing */
  preset: {
    label: string;
    code: string;
    color: string;
    gained: number;
    from: number | null;
    to: number;
    delta: number;
    href: string;
  } | null;
  fastest: { code: string; time: string } | null;
}

const fmtLap = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

/**
 * The featured race (Silverstone) for the landing stickers, from the same
 * offline bundle the Race Lab uses. Loads after `enabled` flips (when the flow
 * gets near), computes the ghost presets in an idle slot. Everything shown is
 * derived from the data; while loading, fields are empty and the UI says so.
 */
export function useFeatureRace(enabled: boolean, season: SeasonData | null): FeatureRace | null {
  const [bundle, setBundle] = useState<RaceBundle | null>(null);
  const [presets, setPresets] = useState<WhatIfPreset[] | null>(null);
  const [codec, setCodec] = useState<((p: WhatIfPreset) => string) | null>(null);

  useEffect(() => {
    if (!enabled || bundle) return;
    let dead = false;
    loadRace(DEFAULT_RACE_SLUG)
      .then((b) => !dead && setBundle(b))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [enabled, bundle]);

  useEffect(() => {
    if (!bundle) return;
    let dead = false;
    const run = () => {
      Promise.all([import('@/engine/strategySimulator'), import('@/components/replay/lib/shareCodec')])
        .then(([sim, share]) => {
          if (dead) return;
          setPresets(sim.computePresets(bundle));
          setCodec(() => (p: WhatIfPreset) => `/replay/${bundle.summary.slug}?ghost=${share.encodeScenario(p.scenario)}`);
        })
        .catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 1500 }) : window.setTimeout(run, 300);
    return () => {
      dead = true;
      if (!w.requestIdleCallback) window.clearTimeout(id);
    };
  }, [bundle]);

  return useMemo(() => {
    if (!bundle) return null;
    const drivers = new Map((season?.drivers ?? []).map((d) => [d.number, d]));
    const teams = new Map((season?.teams ?? []).map((t) => [t.id, t]));
    const look = (n: number) => {
      const d = drivers.get(n);
      return { code: d?.code ?? String(n), color: (d && teams.get(d.teamId)?.color) || d?.color || '#9aa1aa' };
    };
    const finishers = bundle.cars
      .filter((c) => c.finishPosition != null)
      .sort((a, b) => (a.finishPosition as number) - (b.finishPosition as number));
    const winT = finishers[0]?.raceTime ?? null;
    const tower: TowerRow[] = finishers.slice(0, 5).map((c, i) => {
      const lk = look(c.driverNumber);
      let gap = '—';
      if (i === 0) gap = 'WIN';
      else if (c.raceTime != null && winT != null) gap = `+${(c.raceTime - winT).toFixed(3)}`;
      else if (c.status !== 'FINISHED') gap = c.status;
      return { pos: c.finishPosition as number, code: lk.code, color: lk.color, gap };
    });
    const best = presets?.slice().sort((a, b) => b.expected.positionsGained - a.expected.positionsGained)[0];
    const fl = bundle.summary.fastestLap;
    return {
      slug: bundle.summary.slug,
      name: bundle.summary.name,
      circuitName: bundle.summary.circuitName,
      round: bundle.summary.round,
      laps: bundle.summary.totalLaps ?? bundle.totalLaps,
      outline: circuitSvgPath(bundle.circuit, 100),
      start: circuitSvgStart(bundle.circuit, 100),
      tower,
      preset:
        best && codec
          ? {
              label: best.label,
              ...look(best.scenario.driverNumber),
              gained: best.expected.positionsGained,
              from: best.expected.realFinishPosition,
              to: best.expected.ghostFinishPosition,
              delta: best.expected.deltaSeconds,
              href: codec(best),
            }
          : null,
      fastest: fl ? { code: look(fl.driverNumber).code, time: fmtLap(fl.time) } : null,
    };
  }, [bundle, presets, codec, season]);
}
