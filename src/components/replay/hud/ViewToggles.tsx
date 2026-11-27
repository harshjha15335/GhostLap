import { Clapperboard, Wind } from 'lucide-react';
import { useReplayPrefs } from '../lib/prefs';

/** Airflow on/off and director auto-cut on/off (replay-local preferences). */
export function ViewToggles({ vertical = false }: { vertical?: boolean }) {
  const airflow = useReplayPrefs((s) => s.airflow);
  const autoCut = useReplayPrefs((s) => s.autoCut);
  const setAirflow = useReplayPrefs((s) => s.setAirflow);
  const setAutoCut = useReplayPrefs((s) => s.setAutoCut);
  const btn = (on: boolean) =>
    `flex h-9 items-center gap-1.5 px-2.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
      on ? 'bg-pop-sky text-ink' : 'text-ink/75 hover:bg-ink/[0.07] hover:text-ink'
    }`;
  return (
    <div role="group" aria-label="View" className={`flex overflow-hidden rounded-lg border-2 border-ink bg-cream-light shadow-sticker-sm ${vertical ? 'flex-col' : ''}`}>
      <button type="button" className={btn(airflow)} aria-pressed={airflow} title="Airflow / dirty air (A)" onClick={() => setAirflow(!airflow)}>
        <Wind size={14} />
        <span className={vertical ? 'sr-only' : 'hidden lg:inline'}>Airflow</span>
      </button>
      <button type="button" className={btn(autoCut)} aria-pressed={autoCut} title="Auto-cut to incidents and the safety car (C)" onClick={() => setAutoCut(!autoCut)}>
        <Clapperboard size={14} />
        <span className={vertical ? 'sr-only' : 'hidden lg:inline'}>Auto-cut</span>
      </button>
    </div>
  );
}
