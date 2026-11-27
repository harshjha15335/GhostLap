import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { SeasonData } from '@/types';
import { buildRoster } from './roster';
import { mediaFor, parseManifest } from './driverMedia';

const season = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/data/2026/season.json', import.meta.url)), 'utf8')) as SeasonData;

describe('drivers roster', () => {
  const roster = buildRoster(season);

  it('picks exactly two race drivers for each of the 11 teams (22 total)', () => {
    expect(roster.teams).toHaveLength(11);
    for (const t of roster.teams) expect(t.drivers).toHaveLength(2);
    expect(roster.drivers).toHaveLength(22);
    expect(new Set(roster.drivers.map((d) => d.driver.number)).size).toBe(22);
  });

  it('every listed driver is either a race driver or a reserve', () => {
    expect(roster.drivers.length + roster.reserves.length).toBe(season.drivers.length);
  });

  it('race drivers have at least as many classified results as their team reserves', () => {
    for (const r of roster.reserves) {
      const race = roster.teams.find((t) => t.team.id === r.team.id)!.drivers;
      for (const d of race) expect(d.results).toBeGreaterThanOrEqual(r.results);
    }
  });

  it('drivers are ordered by championship position and teams by constructors position', () => {
    const pos = roster.drivers.map((d) => d.standing?.position ?? 999);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    const tp = roster.teams.map((t) => season.constructorStandings.find((c) => c.teamId === t.team.id)?.position ?? 99);
    expect([...tp].sort((a, b) => a - b)).toEqual(tp);
  });
});

describe('driver media manifest', () => {
  it('tolerates an empty or malformed manifest', () => {
    expect(parseManifest(null).drivers).toEqual({});
    expect(parseManifest({ drivers: 'x' }).drivers).toEqual({});
    expect(mediaFor(parseManifest(null), 'NOR')).toEqual({ portrait: null, helmet: null, align: null });
  });

  it('reads portrait/helmet sizes and alignment for a driver', () => {
    const m = parseManifest({
      version: 1,
      drivers: {
        NOR: {
          portrait: { w: 1280, h: 1600, sizes: [800, 1600] },
          helmet: { w: 1280, h: 1600, sizes: [800, 1600] },
          align: { cx: 0.5, cy: 0.3, r: 0.2 },
        },
        BAD: { portrait: { w: 'x' } },
      },
    });
    const nor = mediaFor(m, 'NOR');
    expect(nor.portrait?.sizes).toEqual([800, 1600]);
    expect(nor.align).toEqual({ cx: 0.5, cy: 0.3, r: 0.2 });
    expect(mediaFor(m, 'BAD').portrait).toBeNull();
  });
});
