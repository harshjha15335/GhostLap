import type { ReactNode } from 'react';
import type { RaceSummary } from '@/types';
import { fmtDate } from '@/components/ui/primitives';
import { OfficialOutline } from './TrackOutline';
import FlagName from './FlagName';
import { calendarFacts, fmtLapTime, shortName, stackedName } from './calendarFacts';
import { roundLabel } from './raceBits';

function Fact({ label, children, sub, tone = 'bg-cream', tilt = '' }: { label: string; children: ReactNode; sub?: ReactNode; tone?: string; tilt?: string }) {
  return (
    <div className={`min-w-0 rounded-xl border-[2.5px] border-ink px-3 py-2.5 text-ink shadow-sticker ${tone} ${tilt}`}>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/75">{label}</div>
      <div className="mt-1 min-w-0">{children}</div>
      {sub && <div className="mt-1 truncate font-mono text-[10px] font-semibold text-ink/75">{sub}</div>}
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => <div className="font-display text-[clamp(28px,3.4vw,40px)] leading-none tabular-nums">{children}</div>;

/**
 * Circuits page hero: the 2026 calendar at a glance — real season facts and a strip of every
 * layout. Pure SVG/DOM (no race bundle, no WebGL) so the page paints instantly.
 */
export default function CalendarHero({ races, onPick }: { races: RaceSummary[]; onPick: (slug: string) => void }) {
  const f = calendarFacts(races);
  return (
    <section className="pop-dots relative bg-pop-blue pb-24 pt-16 sm:pb-28" aria-labelledby="calendar-title">
      <div className="pop-halftone pop-halftone-light" />
      <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="inline-flex -rotate-2 items-center gap-2 rounded-md border-2 border-ink bg-cream px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink shadow-sticker-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Circuits · {f.total} events
        </div>
        <h1
          id="calendar-title"
          className="mt-2 font-display text-[clamp(4rem,13vw,11.5rem)] uppercase leading-[0.82] tracking-[0.005em] text-cream [text-shadow:0.04em_0.05em_0_#170F33]"
        >
          <span className="text-pop-sun">2026</span>
          <br />
          Calendar
        </h1>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Fact label="Rounds" tone="bg-pop-sun" tilt="-rotate-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] font-semibold uppercase">
              <span>
                <span className="font-display text-[clamp(28px,3.4vw,40px)] leading-none">{f.completed}</span> done
              </span>
              <span>
                <span className="font-display text-2xl leading-none">{f.upcoming}</span> to go
              </span>
              <span>
                <span className="font-display text-2xl leading-none text-ink-red">{f.cancelled}</span> cancelled
              </span>
            </div>
          </Fact>
          <Fact label="Next race" sub={f.next ? `${fmtDate(f.next.date)} · ${f.next.circuitName}` : undefined} tilt="rotate-1">
            {f.next ? <FlagName country={f.next.country} text={stackedName(f.next.name)} className="text-[clamp(26px,3vw,38px)]" /> : <Big>—</Big>}
          </Fact>
          <Fact label="Shortest lap" tone="bg-pop-pink" sub={f.quickestLap ? `${shortName(f.quickestLap.race.name)} · best lap` : 'no data'} tilt="rotate-[0.6deg]">
            <Big>{f.quickestLap ? fmtLapTime(f.quickestLap.time) : '—'}</Big>
          </Fact>
          <Fact label="Longest lap" tone="bg-pop-sky" sub={f.longestLap ? `${shortName(f.longestLap.race.name)} · best lap` : 'no data'} tilt="-rotate-[0.6deg]">
            <Big>{f.longestLap ? fmtLapTime(f.longestLap.time) : '—'}</Big>
          </Fact>
          <Fact
            label="Most overtakes"
            tone="bg-cream"
            sub={f.mostOvertakes ? `${shortName(f.mostOvertakes.name)} · ${roundLabel(f.mostOvertakes)}` : 'no data'}
            tilt="rotate-[0.4deg] col-span-2 lg:col-span-1"
          >
            <Big>{f.mostOvertakes ? f.mostOvertakes.overtakeCount : '—'}</Big>
          </Fact>
          <div className="col-span-2 rounded-xl border-[2.5px] border-ink bg-cream/95 p-2.5 shadow-sticker lg:col-span-3">
            <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/75">
              <span>Every layout · tap to jump</span>
              <span className="hidden sm:inline">official orientation</span>
            </div>
            <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-9 xl:grid-cols-[repeat(13,minmax(0,1fr))]">
              {races.map((r) => (
                <li key={r.slug}>
                  <button
                    type="button"
                    onClick={() => onPick(r.slug)}
                    aria-label={`${r.name}, ${r.circuitName}${r.status === 'completed' ? '' : ` (${r.status})`}`}
                    title={`${roundLabel(r)} · ${r.name}`}
                    className={`group flex w-full flex-col items-center rounded-md border-2 px-0.5 pb-0.5 pt-1 transition-transform hover:-translate-y-0.5 ${
                      r.status === 'cancelled'
                        ? 'border-dashed border-ink/40 bg-[repeating-linear-gradient(45deg,#F2E6D9_0_6px,#E3D3C2_6px_12px)]'
                        : r.status === 'upcoming'
                          ? 'border-ink/50 bg-[#E9E4F5]'
                          : 'border-ink bg-white'
                    }`}
                  >
                    {r.outline ? (
                      <OfficialOutline outline={r.outline} color="#170F33" halo="rgba(45,59,255,0.12)" strokeWidth={5} className="aspect-square w-full" />
                    ) : (
                      <span className="aspect-square w-full" />
                    )}
                    <span className="font-mono text-[9px] font-bold leading-none text-ink">{r.round > 0 ? roundLabel(r) : 'X'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
