import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { CircuitGeometry } from '@/types';
import type { CircuitCurve } from '@/engine/circuitCurve';
import { TRACK_WIDTH, PIT_LANE_OFFSET } from '../lib/frame';

const UP = new THREE.Vector3(0, 1, 0);
const SECTOR_COLORS = ['#FF1E1E', '#2F7BFF', '#FFD400'];

interface Sample {
  p: THREE.Vector3;
  t: THREE.Vector3;
  r: THREE.Vector3; // right = t × up
  f: number;
}

function sampleCurve(cc: CircuitCurve, n: number): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = (i % n) / n;
    const p = cc.pointAt(f);
    const t = cc.tangentAt(f);
    const r = new THREE.Vector3().crossVectors(t, UP).normalize();
    out.push({ p, t, r, f: i / n });
  }
  return out;
}

/** Flat strip between lateral offsets a..b (right-positive), optionally only where mask[i]. */
function strip(
  s: Sample[],
  a: number,
  b: number,
  lift: number,
  color?: (i: number) => THREE.Color,
  range?: [number, number],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const [i0, i1] = range ?? [0, s.length - 1];
  for (let i = i0; i <= i1; i++) {
    const { p, r } = s[i];
    pos.push(p.x + r.x * a, p.y + lift, p.z + r.z * a, p.x + r.x * b, p.y + lift, p.z + r.z * b);
    if (color) {
      const c = color(i);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (i > i0) {
      const k = (i - i0) * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical curtain from a lateral offset down to ground (gives elevated sections some body). */
function curtain(s: Sample[], off: number, groundY: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  s.forEach(({ p, r }, i) => {
    const x = p.x + r.x * off;
    const z = p.z + r.z * off;
    pos.push(x, p.y - 0.02, z, x, groundY, z);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Red/white kerbs as non-indexed quads so each segment keeps a hard colour. */
function kerbs(s: Sample[], curvature: Float32Array, threshold: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const red = new THREE.Color('#E8102A');
  const white = new THREE.Color('#EDEFF2');
  const inner = TRACK_WIDTH / 2;
  const outer = inner + 0.55;
  for (let i = 0; i < s.length - 1; i++) {
    const k = curvature[i];
    if (Math.abs(k) < threshold) continue;
    // inside of the corner gets the full kerb, outside a narrower exit kerb
    const inside = k > 0 ? -1 : 1;
    const c = Math.floor(i / 2) % 2 === 0 ? red : white;
    for (const side of [inside, -inside]) {
      const o2 = side === inside ? outer : inner + 0.32;
      const A = s[i];
      const B = s[i + 1];
      const v = (S: Sample, off: number) => [S.p.x + S.r.x * off * side, S.p.y + 0.012, S.p.z + S.r.z * off * side];
      const a0 = v(A, inner), a1 = v(A, o2), b0 = v(B, inner), b1 = v(B, o2);
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      for (let q = 0; q < 6; q++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function chequerTexture(cols: number, rows: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = cols * 16;
  c.height = rows * 16;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#0b0b0b' : '#f4f4f4';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Track({ circuit, curve }: { circuit: CircuitGeometry; curve: CircuitCurve }) {
  const built = useMemo(() => {
    const n = Math.min(2400, Math.max(800, Math.round(curve.length / 0.5)));
    const s = sampleCurve(curve, n);
    const ds = curve.length / n;

    // signed curvature (positive = turning left), smoothed
    const raw = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const a = s[(i - 1 + n) % n].t;
      const b = s[(i + 1) % n].t;
      const cross = a.x * b.z - a.z * b.x; // y-component of a × b, sign = turn direction
      raw[i] = (-cross > 0 ? 1 : -1) * a.angleTo(b) / (2 * ds);
    }
    const curvature = new Float32Array(s.length);
    const W = 4;
    for (let i = 0; i < s.length; i++) {
      let acc = 0;
      for (let j = -W; j <= W; j++) acc += raw[(i + j + n) % n];
      curvature[i] = acc / (2 * W + 1);
    }
    // kerbs on the tightest ~22 % of the lap
    const sortedK = Array.from(curvature, Math.abs).sort((x, y) => x - y);
    const threshold = Math.max(0.03, sortedK[Math.floor(sortedK.length * 0.78)]);

    const [sp1, sp2] = circuit.sectorSplits;
    const sectorOf = (f: number) => (f < sp1 ? 0 : f < sp2 ? 1 : 2);
    const base = new THREE.Color('#141820');
    const tints = SECTOR_COLORS.map((c) => base.clone().lerp(new THREE.Color(c), 0.035));
    const rails = SECTOR_COLORS.map((c) => new THREE.Color(c));

    let minY = Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const { p } of s) {
      minY = Math.min(minY, p.y);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const groundY = minY - 0.25;
    const hw = TRACK_WIDTH / 2;

    // pit lane: last 7 % and first 7 % of the lap on the right-hand side
    const pitN = Math.round(n * 0.075);
    const pitA = strip(s, hw + 0.7, hw + 2.0, 0.006, undefined, [n - pitN, n]);
    const pitB = strip(s, hw + 0.7, hw + 2.0, 0.006, undefined, [0, pitN]);

    const geos = {
      asphalt: strip(s, -hw, hw, 0, (i) => tints[sectorOf(s[i].f)]),
      runoff: strip(s, -hw - 2.6, hw + 2.6, -0.01),
      lineL: strip(s, -hw + 0.04, -hw + 0.16, 0.008),
      lineR: strip(s, hw - 0.16, hw - 0.04, 0.008),
      railL: strip(s, -hw - 2.75, -hw - 2.6, 0.004, (i) => rails[sectorOf(s[i].f)]),
      railR: strip(s, hw + 2.6, hw + 2.75, 0.004, (i) => rails[sectorOf(s[i].f)]),
      curtainL: curtain(s, -hw - 2.6, groundY),
      curtainR: curtain(s, hw + 2.6, groundY),
      kerbs: kerbs(s, curvature, threshold),
      pitA,
      pitB,
    };

    // start/finish frame + sector boundary frames
    const frameAt = (f: number) => {
      const p = curve.pointAt(f);
      const t = curve.tangentAt(f);
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(new THREE.Vector3(), t.clone().negate(), UP),
      );
      return { p, q };
    };
    const start = frameAt(0);
    const sectors = [sp1, sp2].map(frameAt);
    const center = new THREE.Vector3((minX + maxX) / 2, minY, (minZ + maxZ) / 2);
    return { geos, start, sectors, groundY, center, extent: Math.max(maxX - minX, maxZ - minZ) };
  }, [circuit, curve]);

  const mats = useMemo(() => {
    const chq = chequerTexture(12, 2);
    const chqBeam = chequerTexture(24, 2);
    return {
      asphalt: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05 }),
      runoff: new THREE.MeshStandardMaterial({ color: '#0c1016', roughness: 1 }),
      line: new THREE.MeshBasicMaterial({ color: '#d9dde3' }),
      rail: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, toneMapped: false }),
      curtain: new THREE.MeshStandardMaterial({ color: '#0a0d12', roughness: 1, side: THREE.DoubleSide }),
      kerb: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
      pit: new THREE.MeshStandardMaterial({ color: '#1b2130', roughness: 0.9 }),
      chq: new THREE.MeshBasicMaterial({ map: chq, polygonOffset: true, polygonOffsetFactor: -2 }),
      beam: new THREE.MeshBasicMaterial({ map: chqBeam }),
      post: new THREE.MeshStandardMaterial({ color: '#2a303b', metalness: 0.6, roughness: 0.4 }),
      neon: new THREE.MeshBasicMaterial({ color: '#D4FF00', toneMapped: false }),
      sector: SECTOR_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, toneMapped: false })),
      ground: new THREE.MeshStandardMaterial({ color: '#06080c', roughness: 1 }),
    };
  }, []);

  useEffect(
    () => () => {
      Object.values(built.geos).forEach((g) => g.dispose());
    },
    [built],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => (Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose()));
      mats.chq.map?.dispose();
      mats.beam.map?.dispose();
    },
    [mats],
  );

  const { geos, start, sectors, groundY, center, extent } = built;
  const gw = TRACK_WIDTH + 2.4;

  return (
    <group>
      {/* ground + grid */}
      <mesh position={[center.x, groundY, center.z]} rotation={[-Math.PI / 2, 0, 0]} material={mats.ground}>
        <planeGeometry args={[extent * 8, extent * 8]} />
      </mesh>
      <gridHelper args={[extent * 3, 60, '#141b27', '#0e131c']} position={[center.x, groundY + 0.01, center.z]} />

      <mesh geometry={geos.curtainL} material={mats.curtain} />
      <mesh geometry={geos.curtainR} material={mats.curtain} />
      <mesh geometry={geos.runoff} material={mats.runoff} />
      <mesh geometry={geos.railL} material={mats.rail} />
      <mesh geometry={geos.railR} material={mats.rail} />
      <mesh geometry={geos.pitA} material={mats.pit} />
      <mesh geometry={geos.pitB} material={mats.pit} />
      <mesh geometry={geos.asphalt} material={mats.asphalt} />
      <mesh geometry={geos.lineL} material={mats.line} />
      <mesh geometry={geos.lineR} material={mats.line} />
      <mesh geometry={geos.kerbs} material={mats.kerb} />

      {/* start / finish: chequered line + gantry */}
      <group position={start.p} quaternion={start.q}>
        <mesh material={mats.chq} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[TRACK_WIDTH, 0.55]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} material={mats.post} position={[s * (gw / 2), 1.6, 0]}>
            <boxGeometry args={[0.22, 3.2, 0.22]} />
          </mesh>
        ))}
        <mesh material={mats.beam} position={[0, 3.1, 0]}>
          <boxGeometry args={[gw + 0.3, 0.42, 0.18]} />
        </mesh>
        {[-2, -1, 0, 1, 2].map((i) => (
          <mesh key={i} material={mats.neon} position={[i * 0.42, 2.72, 0]}>
            <boxGeometry args={[0.22, 0.12, 0.12]} />
          </mesh>
        ))}
        {/* pit-lane entry marker */}
        <mesh material={mats.neon} position={[PIT_LANE_OFFSET, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.3, 0.12]} />
        </mesh>
      </group>

      {/* sector boundaries */}
      {sectors.map((sx, i) => (
        <group key={i} position={sx.p} quaternion={sx.q}>
          <mesh material={mats.sector[i + 1]} position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[TRACK_WIDTH, 0.14]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Bounds helper for cameras. */
export function circuitBounds(curve: CircuitCurve) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < 200; i++) box.expandByPoint(curve.pointAt(i / 200, v));
  return box;
}
