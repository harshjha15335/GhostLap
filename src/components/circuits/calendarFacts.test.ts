import { describe, expect, it } from 'vitest';
import type { RaceSummary } from '@/types';
import seed from '@/data/seed/season.json';
import { calendarFacts, fmtLapTime, shortName } from './calendarFacts';
import { countryIso, flagUrl } from './flags';

const race = (p: Partial<RaceSummary>): RaceSummary => ({
  round: 1,
  slug: 'x',
  meetingKey: 1,
  sessionKey: null,
  name: 'Test Grand Prix',
  country: 'Italy',
  circuitName: 'X',
  date: '2026-03-01T00:00:00+00:00',
  status: 'completed',
  totalLaps: 50,
  podium: [],
  pole: null,
  qualifyingTop3: [],
  winnerGapSeconds: null,
  safetyCars: 0,
  virtualSafetyCars: 0,
  redFlags: 0,
  dnfCount: 0,
  overtakeCount: 0,
  fastestLap: null,
  hasBundle: true,
  ...p,
});

describe('calendarFacts', () => {
  it('counts statuses and picks fastest/slowest laps and most overtakes', () => {
    const races = [
      race({ slug: 'a', fastestLap: { driverNumber: 1, time: 80 }, overtakeCount: 10 }),
      race({ slug: 'b', fastestLap: { driverNumber: 1, time: 100 }, overtakeCount: 40 }),
      race({ slug: 'c', status: 'cancelled', round: 0 }),
      race({ slug: 'd', status: 'upcoming', date: '2026-11-20T00:00:00+00:00' }),
      race({ slug: 'e', status: 'upcoming', date: '2026-12-06T00:00:00+00:00' }),
    ];
    const f = calendarFacts(races, new Date('2026-11-28T00:00:00Z'));
    expect([f.completed, f.upcoming, f.cancelled, f.total]).toEqual([2, 2, 1, 5]);
    expect(f.quickestLap?.race.slug).toBe('a');
    expect(f.longestLap?.race.slug).toBe('b');
    expect(f.mostOvertakes?.slug).toBe('b');
    expect(f.next?.slug).toBe('e');
    expect(calendarFacts(races, new Date('2026-01-01T00:00:00Z')).next?.slug).toBe('d');
  });

  it('formats lap times and short names', () => {
    expect(fmtLapTime(70.374)).toBe('1:10.374');
    expect(shortName('Australian Grand Prix')).toBe('Australian GP');
  });
});

describe('flags', () => {
  it('maps every seed calendar country to a bundled flag', () => {
    const races = (seed as unknown as { races: RaceSummary[] }).races;
    for (const r of races) {
      expect(countryIso(r.country), r.country).not.toBeNull();
      expect(flagUrl(r.country), r.country).toBeTruthy();
    }
    expect(countryIso('United Kingdom')).toBe('gb');
    expect(countryIso('Atlantis')).toBeNull();
  });
});
