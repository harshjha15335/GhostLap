import type { RaceSummary } from '@/types';

export interface CalendarFacts {
  total: number;
  completed: number;
  upcoming: number;
  cancelled: number;
  /** the next upcoming round (first one dated on/after `now`, else the first upcoming) */
  next: RaceSummary | null;
  /** quickest race fastest lap of the season */
  quickestLap: { race: RaceSummary; time: number } | null;
  /** slowest race fastest lap (the longest lap on the calendar by time) */
  longestLap: { race: RaceSummary; time: number } | null;
  /** completed race with the most on-track overtakes */
  mostOvertakes: RaceSummary | null;
}

/** Season facts for the calendar hero — derived only from the season summary data. */
export function calendarFacts(races: RaceSummary[], now: Date = new Date()): CalendarFacts {
  const completed = races.filter((r) => r.status === 'completed');
  const upcoming = races.filter((r) => r.status === 'upcoming');
  const cancelled = races.filter((r) => r.status === 'cancelled');
  const byDate = [...upcoming].sort((a, b) => a.date.localeCompare(b.date));
  // compare by day so a race later today still counts as "next"
  const today = now.toISOString().slice(0, 10);
  const next = byDate.find((r) => r.date.slice(0, 10) >= today) ?? byDate[0] ?? null;

  let quickestLap: CalendarFacts['quickestLap'] = null;
  let longestLap: CalendarFacts['longestLap'] = null;
  let mostOvertakes: RaceSummary | null = null;
  for (const r of completed) {
    const t = r.fastestLap?.time;
    if (t != null && t > 0) {
      if (!quickestLap || t < quickestLap.time) quickestLap = { race: r, time: t };
      if (!longestLap || t > longestLap.time) longestLap = { race: r, time: t };
    }
    if (r.overtakeCount > 0 && (!mostOvertakes || r.overtakeCount > mostOvertakes.overtakeCount)) mostOvertakes = r;
  }
  return {
    total: races.length,
    completed: completed.length,
    upcoming: upcoming.length,
    cancelled: cancelled.length,
    next,
    quickestLap,
    longestLap,
    mostOvertakes,
  };
}

/** 1:23.456 */
export const fmtLapTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;

/** "Australian Grand Prix" → "Australian GP" */
export const shortName = (name: string) => name.replace(/ Grand Prix$/, ' GP');

/** "Australian Grand Prix" → "Australian\nGrand Prix" (two lines: a flag-friendly aspect ratio) */
export const stackedName = (name: string) => name.replace(/ Grand Prix$/, '\nGrand Prix');
