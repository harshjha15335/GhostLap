import type { Driver, PartPoolId, SeasonData } from '@/types';
import { CAR_PARTS } from '@/components/three/F1Car';
import { POOLS, POOL_LABEL, POOL_PART, usedUpTo } from './seasonStats';

/**
 * FIA power-unit / gearbox allocation counters.
 * `partsAllocation.usage` is hand-curated and currently empty, so the bars show the
 * seasonal limits only with an explicit "no data" state — never invented counts.
 */
function PoolBar({ pool, limit, used }: { pool: PartPoolId; limit: number; used: number | null }) {
  const segs = Math.max(limit, used ?? 0);
  const over = used != null && used > limit;
  const onFinal = used != null && used === limit;
  const part = CAR_PARTS.find((p) => p.id === POOL_PART[pool]);
  return (
    <div className="group" title={`${POOL_LABEL[pool]} · lives in ${part?.label ?? ''}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[10px]">
        <span className="font-semibold text-ink">
          {pool}
          <span className="ml-1.5 font-normal text-ink/70">{part?.callout.split(' · ')[0]}</span>
        </span>
        <span className={`font-semibold tabular-nums ${over ? 'text-ink-red' : onFinal ? 'text-ink-amber' : used == null ? 'text-ink/70' : 'text-ink'}`}>
          {used == null ? '–' : used}/{limit}
        </span>
      </div>
      <div className="flex gap-[2px]">
        {Array.from({ length: segs }, (_, i) => {
          let cls = 'border border-dashed border-ink/40 bg-transparent';
          if (used != null) {
            if (i < used) cls = i >= limit ? 'border border-ink bg-crimson' : i === limit - 1 ? 'border border-ink bg-amber' : 'border border-ink bg-paper-green';
            else cls = 'border border-ink/30 bg-white';
          }
          return <span key={i} className={`h-2.5 flex-1 rounded-[1px] ${cls}`} />;
        })}
      </div>
      {over && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-[4px] border-[1.5px] border-ink bg-[#D7102A] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white shadow-sticker-sm">
          GRID PENALTY TRIGGERED
        </div>
      )}
    </div>
  );
}

export default function PartsAllocationPanel({
  season,
  drivers,
  raceIndex,
}: {
  season: SeasonData;
  drivers: Driver[];
  raceIndex: number;
}) {
  const { limits, usage } = season.partsAllocation;
  const race = season.races[raceIndex];
  const hasAny = usage.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="inline-block -rotate-1 rounded-[4px] bg-ink px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-neon">FIA parts allocation</div>
        <div className="mt-1 font-mono text-[11px] text-ink/75">
          Cumulative units after R{race?.round} {race?.circuitName} vs seasonal limit
        </div>
      </div>
      {!hasAny && (
        <div className="rounded-md border-2 border-ink bg-paper-yellow px-3 py-2 font-mono text-[10px] leading-relaxed text-ink shadow-sticker-sm">
          No FIA usage data yet. OpenF1 publishes no power-unit element usage; counters light up once the FIA per-event PU lists are
          added. Limits shown are per driver.
        </div>
      )}
      {drivers.map((d) => {
        const u = usage.find((x) => x.driverNumber === d.number);
        const grid = season.penalties.filter((p) => p.category === 'GRID' && p.driverNumber === d.number && p.round > 0 && p.round <= (race?.round ?? 0));
        return (
          <div key={d.number} className="space-y-2.5">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="h-3.5 w-[5px] ring-1 ring-ink" style={{ background: d.color }} />
              <span className="font-bold text-ink">{d.code}</span>
              <span className="text-ink/70">#{d.number}</span>
              {!u && hasAny && <span className="text-ink/70">· no usage data for this driver</span>}
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {POOLS.map((p) => (
                <PoolBar key={p} pool={p} limit={limits[p]} used={usedUpTo(u, p, raceIndex)} />
              ))}
            </div>
            <div className="font-mono text-[10px] text-ink/70">
              {grid.length ? (
                grid.map((g, i) => (
                  <div key={i} className="font-semibold text-ink-red">
                    R{g.round} · {g.message}
                  </div>
                ))
              ) : (
                <span>No grid penalties in race-control messages up to this round.</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 font-mono text-[9px] font-semibold uppercase tracking-widest text-ink/70">
        <span className="flex items-center gap-1"><span className="h-2 w-3 border border-ink bg-paper-green" />Used</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 border border-ink bg-amber" />Final legal unit</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 border border-ink bg-crimson" />Over limit</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 border border-dashed border-ink/50" />No data</span>
      </div>
    </div>
  );
}
