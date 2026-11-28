import { describe, expect, it } from 'vitest';
import type { CarRace, RaceBundle, RaceSummary, SeasonData } from '@/types';
import { headToHead, raceByRace, teamAchievements, teamDrivers, teamPenaltySummary, teamSheet, teamsByStanding, textOn } from './teamStats';

const race = (round: number, slug: string, over: Partial<RaceSummary> = {}): RaceSummary => ({
  round,
  slug,
  meetingKey: round,
  sessionKey: round,
  name: `${slug} GP`,
  country: 'X',
  circuitName: slug,
  date: '2026-03-01',
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
  ...over,
});

const pace = (q: (number | null)[]) => ({ qualifying: q, race: q, raceFuelCorrected: q });

// red: drivers 1 + 2; blue: 3 + 4 (4 is a one-race substitute)
const season: SeasonData = {
  year: 2026,
  generatedAt: '',
  teams: [
    { id: 'blue', name: 'Blue Racing', color: '#00f' },
    { id: 'red', name: 'Red F1 Team', color: '#f00' },
  ],
  drivers: [
    { number: 1, code: 'AAA', firstName: 'A', lastName: 'A', fullName: 'A A', teamId: 'red', color: '#f00' },
    { number: 2, code: 'BBB', firstName: 'B', lastName: 'B', fullName: 'B B', teamId: 'red', color: '#f00' },
    { number: 3, code: 'CCC', firstName: 'C', lastName: 'C', fullName: 'C C', teamId: 'blue', color: '#00f' },
    { number: 4, code: 'DDD', firstName: 'D', lastName: 'D', fullName: 'D D', teamId: 'blue', color: '#00f' },
    { number: 5, code: 'EEE', firstName: 'E', lastName: 'E', fullName: 'E E', teamId: 'blue', color: '#00f' },
  ],
  races: [
    race(1, 'r1', { podium: [1, 2, 3], pole: 1, fastestLap: { driverNumber: 2, time: 90 } }),
    race(0, 'cx', { status: 'cancelled', hasBundle: false }),
    race(2, 'r2', { podium: [3, 1, 2], pole: 3, fastestLap: { driverNumber: 1, time: 90 } }),
    race(3, 'r3', { status: 'upcoming', hasBundle: false }),
  ],
  driverStandings: [
    { driverNumber: 1, points: 43, position: 1, wins: 1, podiums: 2, pointsByRound: [25, null, 43, null], finishByRound: [1, null, 2, null] },
    { driverNumber: 2, points: 33, position: 2, wins: 0, podiums: 2, pointsByRound: [18, null, 33, null], finishByRound: [2, null, 3, null] },
    { driverNumber: 3, points: 40, position: 3, wins: 1, podiums: 2, pointsByRound: [15, null, 40, null], finishByRound: [3, null, 1, null] },
    { driverNumber: 4, points: 0, position: 5, wins: 0, podiums: 0, pointsByRound: [0, null, 0, null], finishByRound: [null, null, 14, null] },
    { driverNumber: 5, points: 0, position: 6, wins: 0, podiums: 0, pointsByRound: [0, null, 0, null], finishByRound: [11, null, null, null] },
  ],
  constructorStandings: [
    { teamId: 'red', points: 76, position: 1, wins: 1, pointsByRound: [43, null, 76, null] },
    { teamId: 'blue', points: 40, position: 2, wins: 1, pointsByRound: [15, null, 40, null] },
  ],
  penalties: [
    { round: 1, slug: 'r1', driverNumber: 1, lap: 3, category: 'TIME', seconds: 5, message: '5s' },
    { round: 1, slug: 'r1', driverNumber: 2, lap: 3, category: 'WARNING', seconds: null, message: 'w' },
    { round: 2, slug: 'r2', driverNumber: 3, lap: 3, category: 'TIME', seconds: 10, message: '10s' },
  ],
  incidents: [{ round: 2, slug: 'r2', driverNumber: 5, lap: 10, type: 'DNF', message: 'Retired' }],
  upgrades: [],
  driverPace: { 1: pace([0, null, 0.3, null]), 2: pace([0.2, null, 0.1, null]), 3: pace([0.5, null, 0, null]), 5: pace([0.9, null, 0.8, null]) },
  teamPace: {},
  partsAllocation: { limits: { ICE: 4, TC: 4, 'MGU-K': 4, ES: 2, CE: 2, EX: 8, GEARBOX: 4 }, usage: [], source: '' },
};

const car = (n: number, over: Partial<CarRace>): CarRace => ({
  driverNumber: n,
  laps: [],
  sectors: [],
  stints: [],
  pits: [],
  gridPosition: null,
  finishPosition: null,
  status: 'FINISHED',
  dnfLap: null,
  points: 0,
  raceTime: null,
  ...over,
});

const bundle = (slug: string, cars: CarRace[]) => ({ summary: race(1, slug), cars }) as unknown as RaceBundle;

describe('teamStats', () => {
  it('orders teams by constructor position', () => {
    expect(teamsByStanding(season).map((t) => t.id)).toEqual(['red', 'blue']);
  });

  it('orders team drivers regulars first', () => {
    expect(teamDrivers(season, 'blue').map((d) => d.number)).toEqual([3, 4, 5]);
  });

  it('counts achievements from completed races only', () => {
    const a = teamAchievements(season, 'red');
    expect(a.position).toBe(1);
    expect(a.points).toBe(76);
    expect(a.wins).toBe(1);
    expect(a.podiums).toBe(4);
    expect(a.oneTwos).toBe(1);
    expect(a.poles).toBe(1);
    expect(a.fastestLaps).toBe(2);
    expect(a.bestResult).toBe(1);
    expect(a.bestResultCount).toBe(1);
    expect(a.pointsFinishes).toBe(4);
    expect(a.racesInPoints).toBe(2);
    expect(a.dnfs).toBe(0);
    expect(a.pointsProgression).toEqual([43, 76]);
    expect(a.drivers.map((d) => d.driver.code)).toEqual(['AAA', 'BBB']);
  });

  it('includes substitutes in team totals', () => {
    const b = teamAchievements(season, 'blue');
    expect(b.podiums).toBe(2);
    expect(b.oneTwos).toBe(0);
    expect(b.dnfs).toBe(1);
    expect(b.pointsFinishes).toBe(2); // P3, P1 — P11 and P14 out of the points
    expect(b.bestResult).toBe(1);
  });

  it('builds race-by-race lines from bundles with a fallback', () => {
    const bundles = {
      r1: bundle('r1', [
        car(1, { gridPosition: 1, finishPosition: 1, points: 25, pits: [{ lap: 10, laneSeconds: 20, stopSeconds: 2 }, { lap: 30, laneSeconds: 22, stopSeconds: 2 }] }),
        car(2, { gridPosition: 3, finishPosition: 2, points: 18, pits: [{ lap: 12, laneSeconds: 300, stopSeconds: null }] }),
        car(3, { gridPosition: 2, finishPosition: 3, points: 15 }),
      ]),
    };
    const lines = raceByRace(season, 'red', bundles);
    expect(lines).toHaveLength(2);
    expect(lines[0].hasBundle).toBe(true);
    expect(lines[0].teamPoints).toBe(43);
    expect(lines[0].cars.map((c) => c.driverNumber)).toEqual([1, 2]);
    expect(lines[0].cars[0].pitStops).toBe(2);
    expect(lines[0].cars[0].avgPitLane).toBe(21);
    expect(lines[0].cars[1].avgPitLane).toBeNull(); // red-flag / garage stop excluded
    expect(lines[1].hasBundle).toBe(false);
    expect(lines[1].teamPoints).toBe(33);
    expect(lines[1].cars.map((c) => c.finish)).toEqual([2, 3]);
  });

  it('describes retirements without inventing a cause', () => {
    const lines = raceByRace(season, 'blue', {
      r2: bundle('r2', [
        car(3, { finishPosition: 1 }),
        car(5, { status: 'DNF', dnfLap: 10, retirement: { lap: 11, lapFraction: 0.5, time: 900, onTrack: true, kind: 'stopped' } }),
      ]),
    });
    const dnf = lines[1].cars.find((c) => c.driverNumber === 5)!;
    expect(dnf.reason).toBe('Stopped on circuit');
  });

  it('computes reliability and pit-lane averages', () => {
    const s = teamSheet(season, 'blue', [
      bundle('r1', [car(3, { pits: [{ lap: 5, laneSeconds: 24, stopSeconds: 2 }] }), car(5, {})]),
      bundle('r2', [car(3, {}), car(5, { status: 'DNF', retirement: { lap: 1, lapFraction: 0, time: 0, onTrack: true, kind: 'crash' } }), car(4, { status: 'DNS' })]),
    ]);
    expect(s.starts).toBe(4);
    expect(s.classified).toBe(3);
    expect(s.reliability).toBeCloseTo(0.75);
    expect(s.dnfByKind.crash).toBe(1);
    expect(s.avgPitLane).toBe(24);
  });

  it('scores the teammate head-to-head', () => {
    const h = headToHead(season, 'red')!;
    expect(h.a.code).toBe('AAA');
    expect(h.qualifying).toEqual([1, 1]);
    expect(h.race).toEqual([2, 0]);
    expect(h.points).toEqual([43, 33]);
    expect(h.avgFinish[0]).toBe(1.5);
    expect(h.shared).toBe(2);
  });

  it('picks a readable text colour on team colours', () => {
    expect(textOn('#FFD23F')).toBe('ink');
    expect(textOn('#909090')).toBe('ink');
    expect(textOn('#1868DB')).toBe('chalk');
    expect(textOn('#170F33')).toBe('chalk');
  });

  it('summarises team penalties', () => {
    const p = teamPenaltySummary(season, 'red');
    expect(p.sanctions).toBe(1);
    expect(p.timeSeconds).toBe(5);
    expect(p.warnings).toBe(1);
  });
});
