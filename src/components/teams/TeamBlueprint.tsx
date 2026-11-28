import type { ReactNode } from 'react';
import type { Team } from '@/types';
import { StatPlate } from '@/components/ui/primitives';
import { ordinal, upgradeTitle, type TeamAchievements, type TeamSheet } from './teamStats';

/** CAD-style blueprint spec sheet on light drafting paper: blue hairline grid, dimension line, callout leaders, sticker stat plates. */

function Callout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative pl-4">
      <svg className="absolute left-0 top-1 h-4 w-4 text-ink-blue" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="2" cy="2" r="1.6" fill="currentColor" />
        <path d="M2 2 L10 10 L16 10" stroke="currentColor" fill="none" strokeWidth="0.8" />
      </svg>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-blue">{label}</div>
      <div className="font-mono text-[11px] leading-relaxed text-ink/80">{children}</div>
    </div>
  );
}

export default function TeamBlueprint({ team, sheet, ach }: { team: Team; sheet: TeamSheet; ach: TeamAchievements }) {
  const pending = sheet.bundlesLoaded === 0;
  const dnfKinds = (['crash', 'stopped', 'pits', 'unknown'] as const).filter((k) => sheet.dnfByKind[k] > 0);
  const kindLabel = { crash: 'crash', stopped: 'stopped on track', pits: 'retired in pits', unknown: 'no location data' };
  return (
    <section className="drafting-grid relative overflow-hidden rounded-[20px] border-[3px] border-ink bg-cream-light p-4 text-ink shadow-sticker-lg sm:p-6">
      <div className="relative mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-ink-blue">Constructor spec</div>
          <h3 className="mt-1 flex items-center gap-3 font-display text-4xl uppercase leading-none tracking-wide sm:text-5xl">
            <span className="h-9 w-2.5 shrink-0 rounded-[2px] ring-2 ring-ink" style={{ background: team.color }} />
            <span className="min-w-0 break-words">{team.name}</span>
          </h3>
          <div className="mt-3 flex items-center gap-2 font-mono text-[10px] font-semibold text-ink-blue">
            <span className="h-3 w-px bg-ink-blue" />
            <span className="h-px w-8 bg-ink-blue sm:w-24" />
            <span className="whitespace-nowrap">
              {ordinal(sheet.position)} · {sheet.points} PTS
            </span>
            <span className="h-px w-8 bg-ink-blue sm:w-24" />
            <span className="h-3 w-px bg-ink-blue" />
          </div>
        </div>
        <table className="border-2 border-ink bg-white font-mono text-[9px] uppercase text-ink/70">
          <tbody>
            <tr>
              <td className="border border-ink/40 px-2 py-1">DWG</td>
              <td className="border border-ink/40 px-2 py-1 font-semibold text-ink">GL-26-{team.id.toUpperCase().slice(0, 6)}</td>
            </tr>
            <tr>
              <td className="border border-ink/40 px-2 py-1">Source</td>
              <td className="border border-ink/40 px-2 py-1 font-semibold text-ink">OpenF1 · 2026</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatPlate label="Constructor pts" value={sheet.points} accent="#2D3BFF" />
        <StatPlate label="Championship" value={ordinal(sheet.position)} />
        <StatPlate label="Wins" value={ach.wins} sub={ach.oneTwos ? `${ach.oneTwos} one-two${ach.oneTwos > 1 ? 's' : ''}` : undefined} />
        <StatPlate label="Podiums" value={ach.podiums} />
        <StatPlate label="Poles" value={ach.poles} />
        <StatPlate label="Fastest laps" value={ach.fastestLaps} />
        <StatPlate label="Best result" value={ordinal(ach.bestResult)} sub={ach.bestResultCount > 1 ? `× ${ach.bestResultCount}` : undefined} />
        <StatPlate label="Points finishes" value={ach.pointsFinishes} sub={`top 10 · ${ach.racesInPoints} rounds scoring`} />
        <StatPlate
          label="Reliability"
          value={pending ? '…' : sheet.reliability == null ? '—' : `${(sheet.reliability * 100).toFixed(1)}%`}
          sub={pending ? 'loading race bundles' : `${sheet.classified}/${sheet.starts} classified`}
          accent={sheet.reliability != null && sheet.reliability < 0.85 ? '#9C4400' : '#00725F'}
        />
        <StatPlate
          label="DNFs"
          value={ach.dnfs}
          sub={pending ? undefined : dnfKinds.length ? dnfKinds.map((k) => `${sheet.dnfByKind[k]} ${kindLabel[k]}`).join(' · ') : 'none'}
          accent={ach.dnfs ? '#C8102E' : undefined}
        />
        <StatPlate
          label="Avg pit lane"
          value={pending ? '…' : sheet.avgPitLane == null ? '—' : `${sheet.avgPitLane.toFixed(2)}s`}
          sub={pending ? undefined : `${sheet.pitStops} stops · <60s`}
        />
        <StatPlate label="Best pit lane" value={pending ? '…' : sheet.bestPitLane == null ? '—' : `${sheet.bestPitLane.toFixed(2)}s`} sub="lane transit" />
      </div>

      <div className="mt-5">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-blue">Upgrade timeline</div>
        {sheet.upgrades.length ? (
          <ol className="relative flex flex-wrap gap-x-6 gap-y-3 border-t-2 border-dashed border-ink-blue/50 pt-3">
            {sheet.upgrades.map((u) => (
              <li key={`${u.round}-${u.title}`} className="font-mono text-[11px]">
                <div className="font-bold text-ink-blue">
                  R{u.round} · {upgradeTitle(u)}
                </div>
                <div className="tabular-nums text-ink">
                  {u.paceBefore?.toFixed(2) ?? '—'}% → {u.paceAfter?.toFixed(2) ?? '—'}%{' '}
                  <span className="text-ink/70">({u.paceDelta != null ? `${u.paceDelta > 0 ? '+' : ''}${u.paceDelta.toFixed(2)}pp` : '—'})</span>
                </div>
                <div className="text-[9px] text-ink/70">{u.source === 'detected' ? 'area unknown · detected' : `${u.area} · editorial`}</div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="font-mono text-[11px] text-ink/70">No upgrade markers.</div>
        )}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Callout label="Reliability index">Classified finishes ÷ race starts for every car the team entered (incl. substitutes).</Callout>
        <Callout label="Pit lane">Mean pit-lane transit of stops under 60 s (red-flag / garage stops excluded).</Callout>
        <Callout label="Results">Grand Prix results only; points finishes are classified top-10 finishes. Constructor points include sprints.</Callout>
      </div>
    </section>
  );
}
