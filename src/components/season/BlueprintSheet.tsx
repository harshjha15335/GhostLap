import type { ReactNode } from 'react';
import { StatPlate, fmtPct } from '@/components/ui/primitives';
import type { DriverSheet, Entity, TeamSheet } from './seasonStats';
import { upgradeTitle } from './seasonStats';

/** CAD-style blueprint spec sheet: hairline grid, dimension line, callout leaders, monospace stat plates. */

const ordinal = (n: number | null) => (n == null ? '—' : `P${n}`);

function Frame({ entity, kicker, children, dimension }: { entity: Entity; kicker: string; children: ReactNode; dimension: string }) {
  return (
    <section
      className="relative overflow-hidden rounded border border-ghost/25 p-4 sm:p-6"
      style={{
        backgroundColor: '#0a1220',
        backgroundImage:
          'linear-gradient(rgba(0,245,212,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,212,0.07) 1px, transparent 1px), linear-gradient(rgba(0,245,212,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,212,0.035) 1px, transparent 1px)',
        backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
      }}
    >
      {/* title block */}
      <div className="relative mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ghost/80">{kicker}</div>
          <h3 className="mt-1 flex items-center gap-3 font-display text-4xl uppercase leading-none tracking-wide sm:text-5xl">
            <span className="h-9 w-1.5 shrink-0" style={{ background: entity.color }} />
            <span className="truncate">{entity.title}</span>
          </h3>
          {/* dimension line */}
          <div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-ghost/80">
            <span className="h-3 w-px bg-ghost/70" />
            <span className="h-px w-8 bg-ghost/60 sm:w-24" />
            <span className="whitespace-nowrap">{dimension}</span>
            <span className="h-px w-8 bg-ghost/60 sm:w-24" />
            <span className="h-3 w-px bg-ghost/70" />
          </div>
        </div>
        <table className="border border-ghost/30 font-mono text-[9px] uppercase text-white/55">
          <tbody>
            <tr>
              <td className="border border-ghost/30 px-2 py-1">DWG</td>
              <td className="border border-ghost/30 px-2 py-1 text-white/85">GL-26-{entity.key.toUpperCase().slice(0, 6)}</td>
            </tr>
            <tr>
              <td className="border border-ghost/30 px-2 py-1">Source</td>
              <td className="border border-ghost/30 px-2 py-1 text-white/85">OpenF1 · 2026</td>
            </tr>
          </tbody>
        </table>
      </div>
      {children}
    </section>
  );
}

function Callout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative pl-4">
      <svg className="absolute left-0 top-1 h-4 w-4 text-ghost/70" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="2" cy="2" r="1.6" fill="currentColor" />
        <path d="M2 2 L10 10 L16 10" stroke="currentColor" fill="none" strokeWidth="0.8" />
      </svg>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ghost/70">{label}</div>
      <div className="font-mono text-[11px] leading-relaxed text-white/75">{children}</div>
    </div>
  );
}

export function DriverBlueprint({ entity, sheet, teamName }: { entity: Entity; sheet: DriverSheet; teamName: string }) {
  const pending = sheet.bundlesLoaded === 0;
  return (
    <Frame entity={entity} kicker={`Driver spec · #${entity.number} · ${teamName}`} dimension={`${ordinal(sheet.position)} · ${sheet.points} PTS`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatPlate label="Points" value={sheet.points} accent="#D4FF00" />
        <StatPlate label="Championship" value={ordinal(sheet.position)} />
        <StatPlate label="Wins" value={sheet.wins} />
        <StatPlate label="Podiums" value={sheet.podiums} />
        <StatPlate label="Poles" value={sheet.poles} sub="from qualifying" />
        <StatPlate label="Overtakes made" value={pending ? '…' : sheet.overtakes ?? '—'} sub={pending ? 'loading race bundles' : `on-track passes · ${sheet.bundlesLoaded} races`} />
        <StatPlate label="Quali gap avg" value={fmtPct(sheet.qualiAvg)} sub="to fastest" />
        <StatPlate label="Race gap avg" value={fmtPct(sheet.raceAvg)} sub="fuel-corrected" />
        <StatPlate
          label="Race − quali"
          value={sheet.paceDelta == null ? '—' : `${sheet.paceDelta > 0 ? '+' : ''}${sheet.paceDelta.toFixed(2)}pp`}
          sub={sheet.paceDelta == null ? undefined : sheet.paceDelta < 0 ? 'stronger on Sunday' : 'stronger on Saturday'}
          accent={sheet.paceDelta != null && sheet.paceDelta < 0 ? '#00F5D4' : '#FF7A00'}
        />
        <StatPlate label="DNFs" value={sheet.dnfs} sub={pending ? 'from incidents' : sheet.starts != null ? `${sheet.starts} starts` : undefined} />
        <StatPlate label="Penalties" value={sheet.sanctions} sub="time / DT / SG / grid" accent={sheet.sanctions ? '#FF1E1E' : undefined} />
        <StatPlate label="Warnings" value={sheet.warnings} sub={`${sheet.investigations} investigations`} />
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Callout label="Pace model">Gaps are % to the fastest car of the weekend; race pace is the median clean lap, fuel-corrected at 0.03 s per lap of fuel remaining.</Callout>
        <Callout label="Overtakes">OpenF1 overtakes in each race bundle, excluding lap 1, pit-related swaps and passes under the Safety Car.</Callout>
        <Callout label="Penalties">Race-control steward messages; investigations listed separately from sanctions.</Callout>
      </div>
    </Frame>
  );
}

export function TeamBlueprint({ entity, sheet }: { entity: Entity; sheet: TeamSheet }) {
  const pending = sheet.bundlesLoaded === 0;
  return (
    <Frame entity={entity} kicker="Constructor spec" dimension={`${ordinal(sheet.position)} · ${sheet.points} PTS`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatPlate label="Constructor pts" value={sheet.points} accent="#D4FF00" />
        <StatPlate label="Championship" value={ordinal(sheet.position)} />
        <StatPlate label="Wins" value={sheet.wins} />
        <StatPlate label="Podiums" value={sheet.podiums} />
        <StatPlate
          label="Reliability"
          value={pending ? '…' : sheet.reliability == null ? '—' : `${(sheet.reliability * 100).toFixed(1)}%`}
          sub={pending ? 'loading race bundles' : `${sheet.classified}/${sheet.starts} classified`}
          accent={sheet.reliability != null && sheet.reliability < 0.85 ? '#FF7A00' : '#00F5D4'}
        />
        <StatPlate
          label="Avg pit lane"
          value={pending ? '…' : sheet.avgPitLane == null ? '—' : `${sheet.avgPitLane.toFixed(2)}s`}
          sub={pending ? undefined : `${sheet.pitStops} stops · <60s`}
        />
      </div>
      <div className="mt-5">
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ghost/70">Upgrade timeline</div>
        {sheet.upgrades.length ? (
          <ol className="relative flex flex-wrap gap-x-6 gap-y-3 border-t border-dashed border-ghost/30 pt-3">
            {sheet.upgrades.map((u) => (
              <li key={`${u.round}-${u.title}`} className="font-mono text-[11px]">
                <div className="text-ghost">R{u.round} · {upgradeTitle(u)}</div>
                <div className="text-white/80 tabular-nums">
                  {u.paceBefore?.toFixed(2) ?? '—'}% → {u.paceAfter?.toFixed(2) ?? '—'}%{' '}
                  <span className="text-white/45">({u.paceDelta != null ? `${u.paceDelta > 0 ? '+' : ''}${u.paceDelta.toFixed(2)}pp` : '—'})</span>
                </div>
                <div className="text-[9px] text-white/35">{u.source === 'detected' ? 'area unknown · detected' : `${u.area} · editorial`}</div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="font-mono text-[11px] text-white/45">No upgrade markers.</div>
        )}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Callout label="Reliability index">Classified finishes ÷ race starts for every car the team entered (incl. substitutes).</Callout>
        <Callout label="Pit lane">Mean pit-lane transit of stops under 60 s (red-flag / garage stops excluded).</Callout>
      </div>
    </Frame>
  );
}
