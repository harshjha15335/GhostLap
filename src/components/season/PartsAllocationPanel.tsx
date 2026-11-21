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
        <span className="text-white/80">
          {pool}
          <span className="ml-1.5 text-white/30">{part?.callout.split(' · ')[0]}</span>
        </span>
        <span className={`tabular-nums ${over ? 'text-crimson' : onFinal ? 'text-amber' : used == null ? 'text-white/35' : 'text-white/70'}`}>
          {used == null ? '–' : used}/{limit}
        </span>
      </div>
      <div className="flex gap-[2px]">
        {Array.from({ length: segs }, (_, i) => {
          let cls = 'border border-dashed border-white/15 bg-transparent';
          if (used != null) {
            if (i < used) cls = i >= limit ? 'bg-crimson shadow-[0_0_8px_#FF1E1E]' : i === limit - 1 ? 'bg-amber' : 'bg-neon';
            else cls = 'border border-white/15 bg-white/[0.03]';
          }
          return <span key={i} className={`h-2.5 flex-1 rounded-[1px] ${cls}`} />;
        })}
      </div>
      {over && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-sm bg-crimson px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-widest text-white">
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
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-neon/80">FIA parts allocation</div>
        <div className="mt-0.5 font-mono text-[11px] text-white/50">
          Cumulative units after R{race?.round} {race?.circuitName} vs seasonal limit
        </div>
      </div>
      {!hasAny && (
        <div className="rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-amber">
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
              <span className="h-3 w-[3px]" style={{ background: d.color }} />
              <span className="font-semibold text-white">{d.code}</span>
              <span className="text-white/40">#{d.number}</span>
              {!u && hasAny && <span className="text-white/35">· no usage data for this driver</span>}
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {POOLS.map((p) => (
                <PoolBar key={p} pool={p} limit={limits[p]} used={usedUpTo(u, p, raceIndex)} />
              ))}
            </div>
            <div className="font-mono text-[10px] text-white/45">
              {grid.length ? (
                grid.map((g, i) => (
                  <div key={i} className="text-crimson">
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
      <div className="flex flex-wrap gap-3 font-mono text-[9px] uppercase tracking-widest text-white/40">
        <span className="flex items-center gap-1"><span className="h-2 w-3 bg-neon" />Used</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 bg-amber" />Final legal unit</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 bg-crimson" />Over limit</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 border border-dashed border-white/30" />No data</span>
      </div>
    </div>
  );
}
