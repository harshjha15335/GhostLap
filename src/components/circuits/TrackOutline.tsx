import { useMemo } from 'react';
import type { CircuitGeometry } from '@/types';

export const SECTOR_COLORS = ['#FF1E1E', '#00F5D4', '#D4FF00'] as const;

/**
 * Top-down 2D SVG outline of a circuit (x → right, z → down, matching a
 * camera looking straight down with -Z up), split into three sector strokes.
 */
export default function TrackOutline({
  circuit,
  className,
  sectors = true,
  strokeWidth = 2.2,
}: {
  circuit: Pick<CircuitGeometry, 'points' | 'sectorSplits'>;
  className?: string;
  sectors?: boolean;
  strokeWidth?: number;
}) {
  const { paths, start, vb } = useMemo(() => {
    const pts = circuit.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, , z] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const pad = 6;
    const w = maxX - minX || 1;
    const h = maxZ - minZ || 1;
    const s = 100 / Math.max(w, h);
    const W = w * s + pad * 2;
    const H = h * s + pad * 2;
    const proj = ([x, , z]: number[]) => [(x - minX) * s + pad, (z - minZ) * s + pad] as const;
    const n = pts.length;
    const step = n > 300 ? 2 : 1;
    const cut = [0, Math.round(circuit.sectorSplits[0] * n), Math.round(circuit.sectorSplits[1] * n), n];
    const seg = (a: number, b: number) => {
      const idx: number[] = [];
      for (let i = a; i < b; i += step) idx.push(i);
      idx.push(b);
      return idx
        .map((i, k) => {
          const [px, py] = proj(pts[i % n]);
          return `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
        })
        .join('');
    };
    const paths = sectors ? [seg(cut[0], cut[1]), seg(cut[1], cut[2]), seg(cut[2], cut[3])] : [seg(0, n)];
    const [sx, sy] = proj(pts[0]);
    return { paths, start: { x: sx, y: sy }, vb: `0 0 ${W.toFixed(1)} ${H.toFixed(1)}` };
  }, [circuit, sectors]);

  return (
    <svg viewBox={vb} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* soft under-glow */}
      <path d={paths.join('')} fill="none" stroke="#ffffff" strokeOpacity={0.06} strokeWidth={strokeWidth * 3.5} strokeLinejoin="round" strokeLinecap="round" />
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={sectors ? SECTOR_COLORS[i] : '#E8ECF2'}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      <circle cx={start.x} cy={start.y} r={strokeWidth * 1.6} fill="#080B10" stroke="#fff" strokeWidth={strokeWidth * 0.7} />
    </svg>
  );
}

/**
 * Official-orientation outline from season data (race.outline: [x, y] in a 0..100 box, start
 * first). Needs no race bundle, so every calendar entry — including cancelled and upcoming
 * rounds — gets an instant map, drawn like the official calendar poster.
 */
export function OfficialOutline({
  outline,
  className,
  strokeWidth = 3.2,
  color = '#F2F4F7',
  halo = 'rgba(255,255,255,0.07)',
}: {
  outline: [number, number][];
  className?: string;
  strokeWidth?: number;
  /** stroke colour (ink on light paper, near-white on dark) */
  color?: string;
  /** wide soft under-stroke */
  halo?: string;
}) {
  const { d, start, angle } = useMemo(() => {
    const d = outline.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
    const [sx, sy] = outline[0];
    const [nx, ny] = outline[1] ?? outline[0];
    return { d, start: { x: sx, y: sy }, angle: (Math.atan2(ny - sy, nx - sx) * 180) / Math.PI };
  }, [outline]);
  return (
    <svg viewBox="-6 -6 112 112" className={className} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={d} fill="none" stroke={halo} strokeWidth={strokeWidth * 3.2} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {/* chequered start/finish marker across the track */}
      <g transform={`translate(${start.x} ${start.y}) rotate(${angle + 90})`}>
        <rect x={-5.6} y={-2.2} width={11.2} height={4.4} fill="#fff" />
        <rect x={-5} y={-1.6} width={10} height={3.2} fill="#080B10" />
        {[-5, -2.5, 0, 2.5].map((x, i) => (
          <g key={x}>
            <rect x={x} y={i % 2 ? 0 : -1.6} width={2.5} height={1.6} fill="#fff" />
          </g>
        ))}
      </g>
    </svg>
  );
}
