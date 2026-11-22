import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, Eye, Video } from 'lucide-react';
import type { CameraMode, TrackStatusType } from '@/types';
import { useRaceLab } from '@/store/raceLabStore';
import { useSeason } from '@/store/seasonStore';
import { useTicker } from '../lib/frame';

const CAMS: { id: CameraMode; label: string; key: string; Icon: typeof Camera }[] = [
  { id: 'broadcast', label: 'Broadcast', key: '1', Icon: Video },
  { id: 'topdown', label: 'Top-Down', key: '2', Icon: Eye },
  { id: 'chase', label: 'Chase', key: '3', Icon: Camera },
];

export function RaceSelector() {
  const season = useSeason();
  const slug = useRaceLab((s) => s.slug);
  const bundle = useRaceLab((s) => s.bundle);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const current = season?.races.find((r) => r.slug === slug) ?? bundle?.summary;
  let round = 0;
  const races = (season?.races ?? []).map((r) => ({ ...r, n: r.status === 'cancelled' ? null : ++round }));

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border-2 border-ink bg-cream-light px-2.5 py-1.5 text-left text-ink shadow-sticker transition-transform hover:-translate-y-px"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="shrink-0 -rotate-3 rounded-[4px] border-[1.5px] border-ink bg-neon px-1 font-mono text-[10px] font-bold text-ink">
          R{String(current?.round ?? 0).padStart(2, '0')}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] leading-tight tracking-wide text-ink md:text-lg">
            {current?.name?.toUpperCase() ?? 'LOADING…'}
          </span>
          <span className="hidden truncate font-mono text-[10px] text-ink/70 md:block">
            {current ? `${current.circuitName} · ${current.country} · ${new Date(current.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-ink transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="scrollbar-thin absolute left-0 top-full z-40 mt-2 max-h-[60vh] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-xl border-2 border-ink bg-cream-light py-1 text-ink shadow-sticker"
        >
          {races.map((r) => {
            const ok = r.status === 'completed' && r.hasBundle;
            const active = r.slug === slug;
            return (
              <li key={r.slug}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={!ok}
                  onClick={() => {
                    setOpen(false);
                    if (!active) navigate(`/replay/${r.slug}?autoplay=1`);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    active ? 'bg-neon font-semibold text-ink' : ok ? 'text-ink hover:bg-ink/[0.07]' : 'cursor-not-allowed text-ink/55'
                  }`}
                >
                  <span className="w-7 font-mono text-[10px] text-ink/70">{r.n ? `R${String(r.n).padStart(2, '0')}` : '—'}</span>
                  <span className="flex-1 truncate">{r.name}</span>
                  {r.status !== 'completed' && (
                    <span
                      className={`rounded-[3px] border border-ink px-1 font-mono text-[9px] font-bold uppercase ${
                        r.status === 'cancelled' ? 'bg-[#D7102A] text-white' : 'bg-paper-lilac text-ink'
                      }`}
                    >
                      {r.status}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {!season && <li className="px-3 py-2 font-mono text-xs text-ink/70">Loading calendar…</li>}
        </ul>
      )}
    </div>
  );
}

export function CameraSwitch({ vertical = false }: { vertical?: boolean }) {
  const camera = useRaceLab((s) => s.camera);
  const setCamera = useRaceLab((s) => s.setCamera);
  return (
    <div
      role="group"
      aria-label="Camera"
      className={`flex overflow-hidden rounded-lg border-2 border-ink bg-cream-light shadow-sticker-sm ${vertical ? 'flex-col' : ''}`}
    >
      {CAMS.map(({ id, label, key, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setCamera(id)}
          title={`${label} camera (${key})`}
          aria-pressed={camera === id}
          className={`flex h-9 items-center gap-1.5 px-2.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
            camera === id ? 'bg-neon text-ink' : 'text-ink/75 hover:bg-ink/[0.07] hover:text-ink'
          }`}
        >
          <Icon size={14} />
          <span className={vertical ? 'sr-only' : 'hidden lg:inline'}>{label}</span>
        </button>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<TrackStatusType | 'FLAG', { text: string; cls: string }> = {
  SC: { text: 'SAFETY CAR', cls: 'bg-[#FFD400] text-ink' },
  VSC: { text: 'VIRTUAL SAFETY CAR', cls: 'bg-amber text-ink' },
  RED: { text: 'RED FLAG', cls: 'bg-[#D7102A] text-white' },
  FLAG: { text: 'CHEQUERED FLAG', cls: 'bg-white text-ink' },
};

export function TrackStatusBanner() {
  useTicker(4);
  const { timeline, time } = useRaceLab.getState();
  if (!timeline) return null;
  const b = timeline.bundle;
  const winner = b.cars.find((c) => c.finishPosition === 1) ?? b.cars[0];
  const wCum = timeline.cumulative.get(winner.driverNumber) ?? [];
  const finished = time >= (wCum[wCum.length - 1] ?? Infinity);
  const st = timeline.trackStatusAt(time);
  const key = finished ? 'FLAG' : st;
  if (!key) return null;
  const s = STATUS_STYLE[key];
  return (
    <div
      className={`pointer-events-none flex -rotate-1 items-center gap-2 rounded-md border-2 border-ink px-3 py-1 font-display text-sm tracking-[0.18em] shadow-sticker md:text-base ${s.cls} ${
        key === 'FLAG' ? 'bg-[repeating-linear-gradient(45deg,#fff_0_8px,#ddd_8px_16px)]' : 'animate-pulse'
      }`}
      role="status"
    >
      {key !== 'FLAG' && <span className="h-2 w-2 rounded-full bg-current" />}
      {s.text}
    </div>
  );

}
