import { useMemo, useState } from 'react';
import type { IncidentType, PenaltyCategory, SeasonData } from '@/types';
import { useDriverLookup } from '@/store/seasonStore';
import { DriverChip, Segmented } from '@/components/ui/primitives';
import { INCIDENT_TYPES, PENALTY_CATEGORIES, completedIndices } from './seasonStats';

/** FIA penalties (race-control steward messages) + incidents, filterable. */

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

const TAG_STYLE: Partial<Record<Row['tag'], string>> = {
  TIME: 'text-amber border-amber/40',
  DRIVE_THROUGH: 'text-crimson border-crimson/40',
  STOP_GO: 'text-crimson border-crimson/40',
  GRID: 'text-crimson border-crimson/40',
  WARNING: 'text-yellow-300 border-yellow-300/40',
  REPRIMAND: 'text-yellow-300 border-yellow-300/40',
  INVESTIGATION: 'text-white/60 border-white/20',
  CRASH: 'text-crimson border-crimson/40',
  DNF: 'text-white/80 border-white/30',
  SC: 'text-amber border-amber/40',
  VSC: 'text-yellow-300 border-yellow-300/40',
  RED: 'text-crimson border-crimson/60',
};

const selectCls =
  'min-w-0 rounded-sm border border-line bg-asphalt px-2 py-1.5 font-mono text-[11px] text-white/85 focus:border-neon/60 focus:outline-none';

export default function PenaltyLog({ season }: { season: SeasonData }) {
  const { code, color, driver, team } = useDriverLookup();
  const [kind, setKind] = useState<Kind>('all');
  const [round, setRound] = useState<string>('all');
  const [who, setWho] = useState<string>('all');
  const [cat, setCat] = useState<string>('all');
  const [inc, setInc] = useState<string>('all');
  const [limit, setLimit] = useState(40);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let id = 0;
    for (const p of season.penalties)
      out.push({ id: id++, kind: 'penalty', round: p.round, lap: p.lap, driverNumber: p.driverNumber, tag: p.category, seconds: p.seconds, message: p.message });
    for (const i of season.incidents)
      out.push({ id: id++, kind: 'incident', round: i.round, lap: i.lap, driverNumber: i.driverNumber, tag: i.type, seconds: null, message: i.message });
    return out.sort((a, b) => a.round - b.round || (a.lap ?? 0) - (b.lap ?? 0));
  }, [season]);

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
    <div className="rounded border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between">
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
          <select aria-label="Driver or team" className={selectCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">All drivers & teams</option>
            <optgroup label="Teams">
              {season.teams.map((t) => (
                <option key={t.id} value={`t:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Drivers">
              {[...season.drivers].sort((a, b) => a.code.localeCompare(b.code)).map((d) => (
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
      <div className="flex items-center justify-between px-3 py-2 font-mono text-[10px] text-white/45">
        <span>
          {filtered.length} records · {counts.penalties} penalties · {counts.incidents} incidents
        </span>
        <span className="hidden sm:inline">Source: race-control messages via OpenF1</span>
      </div>
      <ul className="divide-y divide-line/70">
        {filtered.slice(0, limit).map((r) => {
          const race = season.races.find((x) => x.round === r.round && x.status === 'completed');
          const d = r.driverNumber != null ? driver(r.driverNumber) : undefined;
          return (
            <li key={r.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[110px_70px_120px_1fr]">
              <div className="font-mono text-[10px] text-white/50">
                <span className="text-white/85">R{r.round}</span> {race?.circuitName}
                {r.lap != null && <span className="ml-1 text-white/35">L{r.lap}</span>}
              </div>
              <div className="flex items-center justify-end gap-1 sm:justify-start">
                {r.driverNumber != null ? (
                  <DriverChip code={code(r.driverNumber)} color={color(r.driverNumber)} title={d ? `${d.fullName} · ${team(d.teamId)?.name ?? ''}` : undefined} />
                ) : (
                  <span className="font-mono text-[10px] text-white/30">—</span>
                )}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className={`inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[9px] tracking-wider ${TAG_STYLE[r.tag] ?? 'border-white/20 text-white/60'}`}>
                  {r.tag.replace('_', ' ')}
                  {r.seconds != null && ` +${r.seconds}s`}
                </span>
              </div>
              <div className="col-span-2 break-words font-mono text-[10.5px] leading-snug text-white/70 sm:col-span-1">{r.message}</div>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && <div className="p-6 text-center font-mono text-[11px] text-white/40">No records match these filters.</div>}
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 60)}
          className="w-full border-t border-line py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-neon hover:bg-white/5"
        >
          Show more · {filtered.length - limit} remaining
        </button>
      )}
    </div>
  );
}
