import { Clapperboard, Gauge, Wind } from 'lucide-react';
import { useReplayPrefs, type QualityMode } from '../lib/prefs';
import { qualityLevel, useReplayQuality } from '../lib/quality';

const NEXT: Record<QualityMode, QualityMode> = { auto: 'high', high: 'low', low: 'auto' };
const LABEL: Record<QualityMode, string> = { auto: 'Auto', high: 'High', low: 'Low' };

/** Airflow on/off, director auto-cut on/off and render quality Auto / High / Low (replay-local preferences). */
export function ViewToggles({ vertical = false }: { vertical?: boolean }) {
  const airflow = useReplayPrefs((s) => s.airflow);
  const autoCut = useReplayPrefs((s) => s.autoCut);
  const setAirflow = useReplayPrefs((s) => s.setAirflow);
  const setAutoCut = useReplayPrefs((s) => s.setAutoCut);
  const quality = useReplayPrefs((s) => s.quality);
  const setQuality = useReplayPrefs((s) => s.setQuality);
  const factor = useReplayQuality((s) => s.factor);
  const fps = useReplayQuality((s) => s.fps);
  const level = Math.round(qualityLevel(quality, factor) * 100);
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
      <button
        type="button"
        className={btn(quality !== 'auto')}
        title={`Render quality: ${LABEL[quality]}${quality === 'auto' ? ` (adapts to frame rate · now ${level}%${fps ? ` · ${Math.round(fps)} fps` : ''})` : ''} — click for ${LABEL[NEXT[quality]]} (Q)`}
        aria-label={`Render quality ${LABEL[quality]}`}
        data-quality={quality}
        onClick={() => setQuality(NEXT[quality])}
      >
        <Gauge size={14} />
        <span className={vertical ? 'sr-only' : 'font-mono'}>{LABEL[quality]}</span>
      </button>
    </div>
  );
}
