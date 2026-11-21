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
