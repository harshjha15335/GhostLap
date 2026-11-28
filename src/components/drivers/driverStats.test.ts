import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { RaceBundle, SeasonData } from '@/types';
import { buildDriverDetail, bundleSlugs, fmtLap, lapsLedBy, weekendPoints } from './driverStats';
import { buildRoster } from './roster';

const read = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/data/2026/${p}`, import.meta.url)), 'utf8'));
const season = read('season.json') as SeasonData;
const bundles: Record<string, RaceBundle> = {};
for (const r of season.races) if (r.hasBundle) bundles[r.slug] = read(`races/${r.slug}.json`) as RaceBundle;
const num = (code: string) => season.drivers.find((d) => d.code === code)!.number;

describe('driverStats helpers', () => {
  it('weekendPoints differences the cumulative standings, skipping cancelled rounds', () => {
    expect(weekendPoints([18, 47, null, null, 72], 0)).toBe(18);
    expect(weekendPoints([18, 47, null, null, 72], 1)).toBe(29);
    expect(weekendPoints([18, 47, null, null, 72], 4)).toBe(25);
    expect(weekendPoints([18, 47, null, null, 72], 2)).toBeNull();
  });

  it('formats lap times', () => {
    expect(fmtLap(82.091)).toBe('1:22.091');
    expect(fmtLap(65.5)).toBe('1:05.500');
    expect(fmtLap(null)).toBe('—');
  });

  it('laps led across all cars add up to the race distance, and the winner led some', () => {
    for (const b of Object.values(bundles)) {
      const total = b.cars.reduce((a, c) => a + lapsLedBy(b, c.driverNumber), 0);
      expect(total).toBe(Math.max(...b.cars.map((c) => c.laps.length)));
      const winner = b.cars.find((c) => c.finishPosition === 1);
      if (winner) expect(lapsLedBy(b, winner.driverNumber)).toBeGreaterThan(0);
    }
  });
});

describe('buildDriverDetail', () => {
  const leader = buildRoster(season).drivers[0];
  const d = buildDriverDetail(season, leader.driver.number, bundles)!;

  it('matches the championship standings', () => {
    const st = season.driverStandings.find((s) => s.driverNumber === leader.driver.number)!;
    expect(d.position).toBe(1);
    expect(d.points).toBe(st.points);
    expect(d.wins).toHaveLength(st.wins);
    expect(d.podiums).toHaveLength(st.podiums);
    // weekend points add up to the season total
    const weekend = d.rows.reduce((a, r) => a + (r.weekendPoints ?? 0), 0);
    expect(weekend).toBeCloseTo(st.points, 5);
  });

  it('loads every bundle the driver raced in and fills the bundle-based stats', () => {
    expect(d.bundlesLoaded).toBe(d.bundlesWanted);
    expect(d.bundlesWanted).toBe(bundleSlugs(season, leader.driver.number).length);
    expect(d.starts).toBeGreaterThan(0);
    expect(d.overtakesMade).not.toBeNull();
    expect(d.lapsLed).toBeGreaterThan(0);
    for (const r of d.rows) if (r.status === 'FINISHED' && r.race.podium[0] === leader.driver.number) expect(r.finish).toBe(1);
  });

  it('without bundles the bundle-based stats are null (no data), not zero', () => {
    const e = buildDriverDetail(season, leader.driver.number, {})!;
    expect(e.starts).toBeNull();
    expect(e.lapsLed).toBeNull();
    expect(e.avgGrid).toBeNull();
    expect(e.rows.every((r) => r.grid == null && r.pits == null)).toBe(true);
    expect(e.wins.length).toBe(d.wins.length);
  });

  it('lists retirements with lap and reason (BOT, Melbourne: stopped on track, lap 16)', () => {
    const bot = buildDriverDetail(season, num('BOT'), bundles)!;
    const mel = bot.retirements.find((r) => r.race.slug === 'melbourne')!;
    expect(mel.status).toBe('DNF');
    expect(mel.lap).toBe(16);
    expect(mel.kind).toBe('stopped');
    expect(mel.reason).toBe('Stopped on track');
    const baku = bot.retirements.find((r) => r.race.slug === 'baku')!;
    expect(baku.kind).toBe('crash');
    expect(baku.message).toMatch(/INCIDENT INVOLVING CAR 77/);
    // DNS at Interlagos carries no lap
    const dns = bot.retirements.find((r) => r.race.slug === 'interlagos')!;
    expect(dns.status).toBe('DNS');
    expect(dns.lap).toBeNull();
  });

  it('teammate head-to-heads only count rounds both drivers have data for', () => {
    for (const e of buildRoster(season).drivers) {
      const det = buildDriverDetail(season, e.driver.number, {})!;
      for (const t of det.teammates) {
        expect(t.driver.teamId).toBe(e.driver.teamId);
        expect(t.quali[0] + t.quali[1]).toBeLessThanOrEqual(det.completed.length);
        expect(t.race[0] + t.race[1]).toBeLessThanOrEqual(det.completed.length);
        // symmetric from the teammate's side
        const back = buildDriverDetail(season, t.driver.number, {})!.teammates.find((x) => x.driver.number === e.driver.number)!;
        expect(back.quali).toEqual([t.quali[1], t.quali[0]]);
        expect(back.race).toEqual([t.race[1], t.race[0]]);
      }
    }
  });

  it('returns null for an unknown driver', () => {
    expect(buildDriverDetail(season, 999, bundles)).toBeNull();
  });
});
