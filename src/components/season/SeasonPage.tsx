import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, ChevronRight, Trophy } from 'lucide-react';
import type { SeasonData } from '@/types';
import type { CarPartId } from '@/components/three/F1Car';
import { useSeason } from '@/store/seasonStore';
import Loader from '@/components/ui/Loader';
import { useRaceBundles } from '@/components/ui/hooks';
import { Segmented, SectionHeading } from '@/components/ui/primitives';
import {
  UPGRADE_AREA_PARTS,
  buildEntities,
  completedIndices,
  driverSheet,
  teamDrivers,
  teamSheet,
  upgradeTitle,
  type Entity,
  type EntityMode,
} from './seasonStats';
import type { StageId } from './SeasonStage';
import PartsAllocationPanel from './PartsAllocationPanel';
import { DriverBlueprint, TeamBlueprint } from './BlueprintSheet';
import { LineChart, UpgradeBadges, type Series } from './Charts';
import PenaltyLog from './PenaltyLog';

const SeasonStage = lazy(() => import('./SeasonStage'));

const PART_LABEL: Record<CarPartId, string> = {
  frontWing: 'front wing',
  monocoque: 'monocoque',
  floor: 'floor',
  sidepods: 'sidepods',
  ice: 'ICE',
  ers: 'ERS',
  gearbox: 'gearbox',
  rearWing: 'rear wing',
};

function Carousel({ entities, selectedKey, onSelect }: { entities: Entity[]; selectedKey: string | null; onSelect: (k: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selectedKey ?? '')}"]`);
    if (el && ref.current) {
      const box = ref.current;
      const left = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
      box.scrollTo({ left, behavior: 'smooth' });
    }
  }, [selectedKey]);
  return (
    <div ref={ref} className="scrollbar-thin flex snap-x gap-2 overflow-x-auto pb-2" role="listbox" aria-label="Showroom selector">
      {entities.map((e) => {
        const active = e.key === selectedKey;
        return (
          <button
            key={e.key}
            data-key={e.key}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onSelect(e.key)}
            className={`group relative flex w-[132px] shrink-0 snap-start flex-col overflow-hidden rounded border bg-panel px-3 pb-2 pt-3 text-left transition-all ${
              active ? 'border-neon/80 bg-[#151c12] shadow-[0_0_24px_-8px_#D4FF00]' : 'border-line hover:-translate-y-0.5 hover:border-white/30'
            }`}
          >
            <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: e.color }} />
            <span className="font-mono text-[10px] text-white/40">{e.position != null ? `P${e.position}` : '—'}{e.number != null && ` · #${e.number}`}</span>
            <span className="truncate font-display text-xl uppercase leading-tight tracking-wide text-white">{e.label}</span>
            <span className="truncate font-mono text-[10px] text-white/45">{e.mode === 'drivers' ? e.title : ''}</span>
            <span className={`mt-1 font-mono text-[11px] tabular-nums ${active ? 'text-neon' : 'text-white/75'}`}>{e.points} pts</span>
          </button>
        );
      })}
    </div>
  );
}

function SeasonIntel({ season }: { season: SeasonData }) {
  const [params, setParams] = useSearchParams();
  const done = useMemo(() => completedIndices(season), [season]);
  const [mode, setModeState] = useState<EntityMode>(params.get('mode') === 'teams' ? 'teams' : 'drivers');
  const [stage, setStageState] = useState<StageId>(params.get('stage') === 'exploded' ? 'exploded' : 'showroom');
  const drivers = useMemo(() => buildEntities(season, 'drivers'), [season]);
  const teams = useMemo(() => buildEntities(season, 'teams'), [season]);
  const [driverKey, setDriverKey] = useState<string>(() => (mode === 'drivers' && params.get('sel')) || drivers[0]?.key);
  const [teamKey, setTeamKey] = useState<string>(() => (mode === 'teams' && params.get('sel')) || teams[0]?.key);
  const [raceIndex, setRaceIndex] = useState<number>(done[done.length - 1] ?? 0);
  const [explode, setExplode] = useState(0.6);
  const [scrollLink, setScrollLink] = useState(true);
  const [hoveredPart, setHoveredPart] = useState<CarPartId | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const entities = mode === 'drivers' ? drivers : teams;
  const selected = (mode === 'drivers' ? drivers.find((d) => d.key === driverKey) : teams.find((t) => t.key === teamKey)) ?? entities[0] ?? null;
  const teamId = selected?.teamId ?? teams[0]?.teamId ?? '';
  const team = season.teams.find((t) => t.id === teamId);
  const teamEntity = teams.find((t) => t.key === teamId) ?? null;

  const sync = useCallback(
    (next: Partial<{ mode: string; stage: string; sel: string }>) => {
      const p = new URLSearchParams(params);
      Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  const setMode = (m: EntityMode) => {
    setModeState(m);
    sync({ mode: m, sel: m === 'drivers' ? driverKey : teamKey });
  };
  const setStage = (s: StageId) => {
    setStageState(s);
    sync({ stage: s });
  };
  const select = (key: string) => {
    if (mode === 'drivers') setDriverKey(key);
    else setTeamKey(key);
    sync({ sel: key });
  };

  // race bundles (overtakes, pit lanes, reliability) load lazily in the background
  const slugs = useMemo(() => done.map((i) => season.races[i]).filter((r) => r.hasBundle).map((r) => r.slug), [done, season]);
  const { bundles } = useRaceBundles(slugs);
  const bundleList = useMemo(() => Object.values(bundles), [bundles]);

  // upgrade highlight for the scrubbed round
  const race = season.races[raceIndex];
  const teamUpgrades = useMemo(() => season.upgrades.filter((u) => u.teamId === teamId).sort((a, b) => a.round - b.round), [season, teamId]);
  const activeUpgrades = teamUpgrades.filter((u) => u.round === race?.round);
  const highlightKey = activeUpgrades.flatMap((u) => UPGRADE_AREA_PARTS[u.area]).join(',');
  const highlight = useMemo(() => (highlightKey ? (Array.from(new Set(highlightKey.split(','))) as CarPartId[]) : []), [highlightKey]);

  // scroll-linked expansion of the exploded assembly
  useEffect(() => {
    if (stage !== 'exploded' || !scrollLink) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = stageRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (window.innerHeight * 0.35 - r.top) / (r.height * 0.55)));
        setExplode(0.35 + p * 0.65);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
    };
  }, [stage, scrollLink]);

  const podium = entities.slice(0, 3);
  const partsDrivers = useMemo(() => {
    if (mode === 'drivers') {
      const d = season.drivers.find((x) => String(x.number) === selected?.key);
      return d ? [d] : [];
    }
    return teamDrivers(season, teamId).slice(0, 2);
  }, [mode, season, selected, teamId]);

  const xLabels = done.map((i) => `R${season.races[i].round}`);
  const pick = <T,>(arr: (T | null)[] | undefined) => done.map((i) => (arr ? arr[i] ?? null : null));

  // points progression: selected vs the leader (or vs P2 when the selection leads)
  const pointsSeries = useMemo((): Series[] => {
    if (!selected) return [];
    const list = mode === 'drivers' ? season.driverStandings.map((s) => ({ key: String(s.driverNumber), pos: s.position, pbr: s.pointsByRound })) : season.constructorStandings.map((s) => ({ key: s.teamId, pos: s.position, pbr: s.pointsByRound }));
    const me = list.find((s) => s.key === selected.key);
    const rival = list.find((s) => s.pos === (selected.position === 1 ? 2 : 1));
    const rivalEntity = entities.find((e) => e.key === rival?.key);
    const out: Series[] = [{ id: selected.label, label: selected.title, color: '#D4FF00', values: pick(me?.pbr) }];
    if (rival && rivalEntity) out.push({ id: rivalEntity.label, label: `${rivalEntity.title} (P${rival.pos})`, color: '#8b97a8', values: pick(rival.pbr), dashed: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mode, season, done, entities]);

  const pace = mode === 'drivers' ? season.driverPace[Number(selected?.key)] : season.teamPace[teamId];
  const upgradeMarkers = teamUpgrades
    .map((u) => ({ index: done.findIndex((i) => season.races[i].round === u.round), label: `${upgradeTitle(u)} (R${u.round})` }))
    .filter((m) => m.index >= 0);

  const scrubPos = Math.max(0, done.indexOf(raceIndex));
  const nextUpgrade = teamUpgrades.find((u) => u.round > (race?.round ?? 0)) ?? teamUpgrades[0];
  const jumpToRound = (round: number) => {
    const idx = season.races.findIndex((r) => r.round === round && r.status === 'completed');
    if (idx >= 0) setRaceIndex(idx);
  };

  if (!selected) return null;
  const selDriver = mode === 'drivers' ? season.drivers.find((d) => String(d.number) === selected.key) : undefined;

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-24 pt-16 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-neon/80">
            Drivers & teams intelligence · after R{season.races[done[done.length - 1]]?.round}
          </div>
          <h1 className="font-display text-5xl uppercase leading-none tracking-wide sm:text-6xl">
            Season <span className="text-neon">Showroom</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented<EntityMode>
            label="Drivers or teams"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'drivers', label: `Drivers (${season.drivers.length})` },
              { value: 'teams', label: `Teams (${season.teams.length})` },
            ]}
          />
          <Segmented<StageId>
            label="Stage"
            value={stage}
            onChange={setStage}
            options={[
              { value: 'showroom', label: <span className="flex items-center gap-1.5"><Trophy size={12} /> Podium</span> },
              { value: 'exploded', label: <span className="flex items-center gap-1.5"><Boxes size={12} /> Exploded</span> },
            ]}
          />
        </div>
      </header>

      {/* ---------------- 3D stage ---------------- */}
      <section className="overflow-hidden rounded border border-line bg-panel lg:grid lg:grid-cols-[1fr_360px]">
        <div ref={stageRef} className="relative h-[58vh] min-h-[380px] select-none lg:h-[600px]">
          <Suspense fallback={<Loader label="Lighting the showroom…" />}>
            <SeasonStage
              stage={stage}
              podium={podium}
              selected={selected}
              onSelect={select}
              carColor={team?.color ?? '#D4FF00'}
              explode={explode}
              highlight={highlight}
              onPartHover={setHoveredPart}
              hoveredPart={hoveredPart}
            />
          </Suspense>
          <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">
            {stage === 'showroom' ? (
              <>Podium showroom · {mode === 'drivers' ? "drivers' championship" : "constructors' championship"}</>
            ) : (
              <>
                Exploded assembly · <span style={{ color: team?.color }}>{team?.name}</span> · R{race?.round}
                <span className="hidden sm:inline"> · drag to rotate</span>
              </>
            )}
          </div>
          {stage === 'exploded' && hoveredPart && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-sm border border-ghost/50 bg-asphalt/80 px-2 py-1 font-mono text-[10px] text-ghost">
              {PART_LABEL[hoveredPart]}
            </div>
          )}
          {stage === 'exploded' && (
            <div className="absolute bottom-3 left-3 right-3 max-w-md rounded-sm border border-white/10 bg-asphalt/80 p-2.5 font-mono text-[10px] backdrop-blur sm:right-auto">
              {activeUpgrades.length ? (
                activeUpgrades.map((u) => (
                  <div key={u.title}>
                    <div className="flex items-center gap-2 text-ghost">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ghost" />
                      R{u.round} · {upgradeTitle(u)} · {u.source === 'detected' ? 'area unknown' : u.area}
                    </div>
                    <div className="mt-0.5 text-white/80">
                      Fuel-corrected race pace {u.paceBefore?.toFixed(2) ?? '—'}% → {u.paceAfter?.toFixed(2) ?? '—'}% to fastest
                      {u.paceDelta != null && <span className="text-ghost"> ({u.paceDelta.toFixed(2)} pp)</span>}
                    </div>
                    <div className="text-white/40">
                      Highlighting {UPGRADE_AREA_PARTS[u.area].map((p) => PART_LABEL[p]).join(' + ')}
                      {u.source === 'detected' && ' as candidate areas — not confirmed by the team'}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 text-white/55">
                  No upgrade marker for {team?.name} at R{race?.round}.
                  {nextUpgrade && (
                    <button type="button" className="text-ghost underline-offset-2 hover:underline" onClick={() => jumpToRound(nextUpgrade.round)}>
                      Jump to R{nextUpgrade.round} →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* sidebar */}
        <aside className="max-h-none border-t border-line p-4 lg:max-h-[600px] lg:overflow-y-auto lg:border-l lg:border-t-0 scrollbar-thin">
          {stage === 'exploded' ? (
            <PartsAllocationPanel season={season} drivers={partsDrivers} raceIndex={raceIndex} />
          ) : (
            <div className="flex h-full flex-col gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-neon/80">Centre spotlight</div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="font-display text-6xl leading-none text-white/90">{selected.position != null ? `P${selected.position}` : '—'}</span>
                  <div className="min-w-0">
                    <div className="truncate font-display text-2xl uppercase leading-tight tracking-wide">{selected.title}</div>
                    <div className="font-mono text-[11px] text-white/50">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: selected.color }} />
                      {mode === 'drivers' ? `${team?.name} · #${selected.number}` : `${teamDrivers(season, teamId).map((d) => d.code).join(' · ')}`}
                    </div>
                  </div>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 font-mono">
                {(mode === 'drivers'
                  ? (() => {
                      const s = season.driverStandings.find((x) => String(x.driverNumber) === selected.key);
                      return [
                        ['Points', s?.points ?? 0],
                        ['Wins', s?.wins ?? 0],
                        ['Podiums', s?.podiums ?? 0],
                      ];
                    })()
                  : (() => {
                      const s = season.constructorStandings.find((x) => x.teamId === selected.key);
                      return [
                        ['Points', s?.points ?? 0],
                        ['Wins', s?.wins ?? 0],
                        ['Pace steps', teamUpgrades.length],
                      ];
                    })()
                ).map(([k, v]) => (
                  <div key={k} className="border border-line bg-asphalt/60 px-2 py-2">
                    <dt className="text-[9px] uppercase tracking-widest text-white/40">{k}</dt>
                    <dd className="text-lg tabular-nums text-white">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="font-mono text-[10px] leading-relaxed text-white/40">
                Top three by points stand on the podium. Pick any {mode === 'drivers' ? 'driver' : 'team'} below (or click a podium car) to
                spring it onto the centre spotlight.
              </p>
              <button
                type="button"
                onClick={() => setStage('exploded')}
                className="mt-auto flex items-center justify-center gap-2 rounded-sm border border-ghost/50 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ghost hover:bg-ghost/10"
              >
                <Boxes size={14} /> Explode {teamEntity?.label ?? 'car'} assembly <ChevronRight size={14} />
              </button>
            </div>
          )}
        </aside>

        {/* exploded controls */}
        {stage === 'exploded' && (
          <div className="grid gap-4 border-t border-line p-4 lg:col-span-2 lg:grid-cols-[minmax(220px,320px)_1fr]">
            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
                <label htmlFor="explode">Explode assembly</label>
                <span className="tabular-nums text-neon">{Math.round(explode * 100)}%</span>
              </div>
              <input
                id="explode"
                type="range"
                min={0}
                max={100}
                value={Math.round(explode * 100)}
                onChange={(e) => {
                  setScrollLink(false);
                  setExplode(Number(e.target.value) / 100);
                }}
                className="w-full accent-[#D4FF00]"
              />
              <label className="mt-1 flex items-center gap-2 font-mono text-[10px] text-white/45">
                <input type="checkbox" checked={scrollLink} onChange={(e) => setScrollLink(e.target.checked)} className="accent-[#00F5D4]" />
                Link expansion to page scroll
              </label>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
                <label htmlFor="round">Round scrubber</label>
                <span className="truncate normal-case tracking-normal text-white/85">
                  R{race?.round} {race?.name}
                </span>
              </div>
              <input
                id="round"
                type="range"
                min={0}
                max={done.length - 1}
                value={scrubPos}
                onChange={(e) => setRaceIndex(done[Number(e.target.value)])}
                className="w-full accent-[#00F5D4]"
              />
              <div className="relative mt-1 h-4">
                {done.map((idx, k) => {
                  const r = season.races[idx];
                  const up = teamUpgrades.some((u) => u.round === r.round);
                  const left = done.length > 1 ? (k / (done.length - 1)) * 100 : 50;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setRaceIndex(idx)}
                      title={`R${r.round} ${r.circuitName}${up ? ' · pace step' : ''}`}
                      className={`absolute top-0 -translate-x-1/2 font-mono text-[8px] ${idx === raceIndex ? 'text-white' : up ? 'text-ghost' : 'text-white/30'} ${
                        k % 2 && !up && idx !== raceIndex ? 'hidden sm:block' : ''
                      }`}
                      style={{ left: `${left}%` }}
                    >
                      {up ? '◆' : r.round}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---------------- selector ---------------- */}
      <div className="mt-4">
        <Carousel entities={entities} selectedKey={selected.key} onSelect={select} />
      </div>

      {/* ---------------- blueprint ---------------- */}
      <div className="mt-12">
        <SectionHeading kicker="Blueprint" title="Spec sheet" />
        {mode === 'drivers' ? (
          <DriverBlueprint entity={selected} sheet={driverSheet(season, Number(selected.key), bundleList)} teamName={team?.name ?? ''} />
        ) : (
          <TeamBlueprint entity={selected} sheet={teamSheet(season, teamId, bundleList)} />
        )}
      </div>

      {/* ---------------- charts ---------------- */}
      <div className="mt-12">
        <SectionHeading kicker="Telemetry" title="Form charts" />
        <div className="grid gap-3 lg:grid-cols-2">
          <LineChart
            title="Points progression"
            subtitle={`Cumulative ${mode === 'drivers' ? 'driver' : 'constructor'} points per completed round`}
            xLabels={xLabels}
            series={pointsSeries}
          />
          <LineChart
            title="Qualifying vs race pace"
            subtitle={`${selDriver ? selDriver.code : team?.name} · gap to fastest (%), lower = faster`}
            xLabels={xLabels}
            invert
            yFormat={(v) => `${v.toFixed(1)}%`}
            markers={upgradeMarkers}
            series={[
              { id: 'Q', label: 'Qualifying', color: '#D4FF00', values: pick(pace?.qualifying) },
              { id: 'R', label: 'Race (fuel-corrected)', color: '#00F5D4', values: pick(pace?.raceFuelCorrected), dashed: true },
            ]}
            footnote={
              <>
                Gaps break where there is no data (DNF / no clean laps). ◆ markers: detected {team?.name} pace steps.
              </>
            }
          />
        </div>
        <div className="mt-3">
          <UpgradeBadges
            upgrades={teamUpgrades}
            teamName={team?.name ?? ''}
            activeRound={stage === 'exploded' ? race?.round : undefined}
            onPick={(round) => {
              jumpToRound(round);
              setStage('exploded');
              stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          />
        </div>
      </div>

      {/* ---------------- penalties ---------------- */}
      <div className="mt-12">
        <SectionHeading kicker="FIA stewards" title="Penalties & incidents" />
        <PenaltyLog season={season} />
      </div>
    </main>
  );
}

export default function SeasonPage() {
  const season = useSeason();
  if (!season) return <main className="pt-12"><Loader label="Loading season…" /></main>;
  return <SeasonIntel season={season} />;
}
