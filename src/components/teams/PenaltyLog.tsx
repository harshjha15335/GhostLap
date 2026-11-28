import { useMemo, useState } from 'react';
import type { IncidentType, PenaltyCategory, SeasonData } from '@/types';
import { useDriverLookup } from '@/store/seasonStore';
import { DriverChip, Segmented } from '@/components/ui/primitives';
import { INCIDENT_TYPES, PENALTY_CATEGORIES, completedIndices } from './teamStats';

/** FIA penalties (race-control steward messages) + incidents, filterable; `teamId` scopes it to one team's cars. */

type Kind = 'all' | 'penalties' | 'incidents';

interface Row {
  id: number;
  kind: 'penalty' | 'incident';
  round: number;
  lap: number | null;
  driverNumber: number | null;
  tag: PenaltyCategory | IncidentType;
  seconds: number | null;
  message: string;
}

/** Flat-colour sticker tags (all ≥ 4.5:1 text contrast). */
const RED_TAG = 'bg-[#D7102A] text-white';
const TAG_STYLE: Partial<Record<Row['tag'], string>> = {
  TIME: 'bg-pop-papaya text-ink',
  DRIVE_THROUGH: RED_TAG,
  STOP_GO: RED_TAG,
  GRID: RED_TAG,
  WARNING: 'bg-pop-sun text-ink',
  REPRIMAND: 'bg-pop-sun text-ink',
  INVESTIGATION: 'bg-white text-ink',
  CRASH: RED_TAG,
  DNF: 'bg-ink text-cream',
  SC: 'bg-pop-papaya text-ink',
  VSC: 'bg-pop-sun text-ink',
  RED: RED_TAG,
};

const selectCls =
  'min-w-0 rounded-md border-2 border-ink bg-white px-2 py-1.5 font-mono text-[11px] text-ink disabled:opacity-50';

export default function PenaltyLog({ season, teamId }: { season: SeasonData; teamId?: string }) {
  const { code, color, driver, team } = useDriverLookup();
  const [kind, setKind] = useState<Kind>('all');
  const [round, setRound] = useState<string>('all');
  const [who, setWho] = useState<string>('all');
  const [cat, setCat] = useState<string>('all');
  const [inc, setInc] = useState<string>('all');
  const [limit, setLimit] = useState(40);

  const teamNums = useMemo(() => (teamId ? new Set(season.drivers.filter((d) => d.teamId === teamId).map((d) => d.number)) : null), [season, teamId]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let id = 0;
    const mine = (n: number | null) => !teamNums || (n != null && teamNums.has(n));
    for (const p of season.penalties)
      if (mine(p.driverNumber)) out.push({ id: id++, kind: 'penalty', round: p.round, lap: p.lap, driverNumber: p.driverNumber, tag: p.category, seconds: p.seconds, message: p.message });
    for (const i of season.incidents)
      if (mine(i.driverNumber)) out.push({ id: id++, kind: 'incident', round: i.round, lap: i.lap, driverNumber: i.driverNumber, tag: i.type, seconds: null, message: i.message });
    return out.sort((a, b) => a.round - b.round || (a.lap ?? 0) - (b.lap ?? 0));
  }, [season, teamNums]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind === 'penalties' && r.kind !== 'penalty') return false;
      if (kind === 'incidents' && r.kind !== 'incident') return false;
      if (round !== 'all' && r.round !== Number(round)) return false;
      if (who !== 'all') {
        if (r.driverNumber == null) return false;
        if (who.startsWith('d:') && r.driverNumber !== Number(who.slice(2))) return false;
        if (who.startsWith('t:') && driver(r.driverNumber)?.teamId !== who.slice(2)) return false;
      }
      if (cat !== 'all' && r.kind === 'penalty' && r.tag !== cat) return false;
      if (inc !== 'all' && r.kind === 'incident' && r.tag !== inc) return false;
      return true;
    });
    // driver() is stable enough for filtering purposes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, kind, round, who, cat, inc]);

  const rounds = completedIndices(season).map((i) => season.races[i]);
  const counts = {
    penalties: filtered.filter((r) => r.kind === 'penalty').length,
    incidents: filtered.filter((r) => r.kind === 'incident').length,
  };

  return (
    <div className="overflow-hidden rounded-[20px] border-[3px] border-ink bg-cream text-ink shadow-sticker-lg">
      <div className="pop-dots flex flex-col gap-3 border-b-[3px] border-ink bg-pop-sun p-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented<Kind>
          size="sm"
          label="Record type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setLimit(40);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'penalties', label: 'Penalties' },
            { value: 'incidents', label: 'Incidents' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select aria-label="Round" className={selectCls} value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="all">All rounds</option>
            {rounds.map((r) => (
              <option key={r.slug} value={r.round}>
                R{r.round} {r.circuitName}
              </option>
            ))}
          </select>
          <select aria-label={teamId ? "Driver" : "Driver or team"} className={selectCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">{teamId ? 'All team cars' : 'All drivers & teams'}</option>
            {!teamId && (
              <optgroup label="Teams">
                {season.teams.map((t) => (
                  <option key={t.id} value={`t:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Drivers">
              {season.drivers.filter((d) => !teamId || d.teamId === teamId).sort((a, b) => a.code.localeCompare(b.code)).map((d) => (
                <option key={d.number} value={`d:${d.number}`}>
                  {d.code} · {d.fullName}
                </option>
              ))}
            </optgroup>
          </select>
          <select
            aria-label="Penalty category"
            className={selectCls}
            value={cat}
            disabled={kind === 'incidents'}
            onChange={(e) => {
              setCat(e.target.value);
              if (e.target.value !== 'all') setKind('penalties');
            }}
          >
            <option value="all">All categories</option>
            {PENALTY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            aria-label="Incident type"
            className={selectCls}
            value={inc}
            disabled={kind === 'penalties'}
            onChange={(e) => {
              setInc(e.target.value);
              if (e.target.value !== 'all') setKind('incidents');
            }}
          >
            <option value="all">All incident types</option>
            {INCIDENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between border-b-2 border-ink/15 px-3 py-2 font-mono text-[10px] font-semibold text-ink/75">
        <span>
          {filtered.length} records · {counts.penalties} penalties · {counts.incidents} incidents
        </span>
        <span className="hidden sm:inline">Source: race-control messages via OpenF1</span>
      </div>
      <ul className="divide-y divide-ink/15">
        {filtered.slice(0, limit).map((r) => {
          const race = season.races.find((x) => x.round === r.round && x.status === 'completed');
          const d = r.driverNumber != null ? driver(r.driverNumber) : undefined;
          return (
            <li key={r.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 odd:bg-white/60 sm:grid-cols-[110px_70px_120px_1fr]">
              <div className="font-mono text-[10px] text-ink/70">
                <span className="font-bold text-ink">R{r.round}</span> {race?.circuitName}
                {r.lap != null && <span className="ml-1 text-ink/70">L{r.lap}</span>}
              </div>
              <div className="flex items-center justify-end gap-1 sm:justify-start">
                {r.driverNumber != null ? (
                  <DriverChip code={code(r.driverNumber)} color={color(r.driverNumber)} title={d ? `${d.fullName} · ${team(d.teamId)?.name ?? ''}` : undefined} />
                ) : (
                  <span className="font-mono text-[10px] text-ink/70">—</span>
                )}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className={`inline-block rounded-[4px] border-[1.5px] border-ink px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider ${TAG_STYLE[r.tag] ?? 'bg-white text-ink'}`}>
                  {r.tag.replace('_', ' ')}
                  {r.seconds != null && ` +${r.seconds}s`}
                </span>
              </div>
              <div className="col-span-2 break-words font-mono text-[10.5px] leading-snug text-ink/80 sm:col-span-1">{r.message}</div>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && <div className="p-6 text-center font-mono text-[11px] text-ink/70">No records match these filters.</div>}
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 60)}
          className="w-full border-t-[3px] border-ink bg-ink py-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pop-sun hover:bg-pop-blue-deep"
        >
          Show more · {filtered.length - limit} remaining
        </button>
      )}
    </div>
  );
}
