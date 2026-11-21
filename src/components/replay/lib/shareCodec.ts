import type { Compound, RaceBundle, WhatIfScenario } from '@/types';

/**
 * Compact What-If share encoding, used as `?ghost=<code>` on /replay/:slug.
 *
 *   <driver>.<fromLap>.<lap>:<C>-<lap>:<C>….<p0|p1>
 *
 *   driver   car number                       16
 *   fromLap  pause lap L0                     20
 *   stops    "-"-separated lap:compound       22:H-40:S   (empty = no stops)
 *   C        S|M|H|I|W  (soft/medium/hard/inter/wet)
 *   p0|p1    avoid-penalties off/on
 *
 *   e.g. /replay/silverstone?ghost=16.20.22:H-40:S.p0
 */
const TO_CODE: Record<Compound, string> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const FROM_CODE: Record<string, Compound> = { S: 'SOFT', M: 'MEDIUM', H: 'HARD', I: 'INTERMEDIATE', W: 'WET' };

export function encodeScenario(sc: WhatIfScenario): string {
  const stops = [...sc.stops]
    .sort((a, b) => a.lap - b.lap)
    .map((s) => `${s.lap}:${TO_CODE[s.compound]}`)
    .join('-');
  return `${sc.driverNumber}.${sc.fromLap}.${stops}.${sc.avoidPenalties ? 'p1' : 'p0'}`;
}

export function decodeScenario(code: string, bundle?: RaceBundle | null): WhatIfScenario | null {
  const m = /^(\d{1,2})\.(\d{1,3})\.((?:\d{1,3}:[SMHIW])(?:-\d{1,3}:[SMHIW])*)?\.p([01])$/i.exec(code.trim());
  if (!m) return null;
  const driverNumber = Number(m[1]);
  const fromLap = Math.max(1, Number(m[2]));
  const stops = (m[3] ?? '')
    .split('-')
    .filter(Boolean)
    .map((tok) => {
      const [lap, c] = tok.split(':');
      return { lap: Number(lap), compound: FROM_CODE[c.toUpperCase()] };
    })
    .sort((a, b) => a.lap - b.lap);
  const sc: WhatIfScenario = { driverNumber, fromLap, stops, avoidPenalties: m[4] === '1' };
  if (bundle) {
    if (!bundle.cars.some((c) => c.driverNumber === driverNumber)) return null;
    const last = bundle.totalLaps - 1;
    sc.fromLap = Math.min(sc.fromLap, last);
    sc.stops = sc.stops.filter((s) => s.lap >= sc.fromLap && s.lap <= last);
  }
  return sc;
}

export function shareUrl(slug: string, sc: WhatIfScenario): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '');
  return `${base}/replay/${slug}?ghost=${encodeScenario(sc)}`;
}
