import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRaceLab } from '@/store/raceLabStore';
import { MAX_CARS, frame } from '../lib/frame';
import { useReplayPrefs } from '../lib/prefs';
import type { RaceScene } from '../lib/raceScene';

/**
 * Airflow / dirty air for the whole field in TWO draw calls (see docs/race-lab/AIRFLOW.md).
 *
 *  1. Streamline ribbons (instanced, camera-facing strips): per car two rear-wing tip
 *     vortices (spiralling cores), two diffuser / beam-wing upwash plumes (the 2022+/2026
 *     "mushroom" wake thrown upwards) and two front-tyre outwash trails, plus two
 *     secondary vortex strands. Dashes stream backwards at a speed tied to car speed.
 *  2. Turbulent wake volume: instanced soft puffs that tumble back along the wake.
 *
 * Everything is evaluated in the vertex shader from per-car uniforms (speed, follower
 * distance + downforceLoss, weight) and a small float texture holding each car's track
 * path behind it (16 samples: position + heading), written from frame.air every frame —
 * no allocations. The wake follows the car's path through corners, lengthens with speed
 * and, when a car
 * is within ~2 s behind, reaches its nose and turns from clean blue to hot orange-red
 * with stronger turbulence (intensity = downforceLoss(gapAhead) of the follower).
 */
const S = 28; // ribbon segments
const PATH_N = 16; // path samples behind each car
/** render units of track path sampled behind each car (≈ 5 car lengths: the longest wake) */
const PATH_LEN = 16;
const RIBBONS = 8; // per car
const PUFFS = 22; // per car

const COMMON = /* glsl */ `
  uniform vec4 uB[${MAX_CARS}]; // speed01 loss follow weight
  uniform vec4 uC[${MAX_CARS}]; // heat scale - -   (heat: warm-colour strength, follower inside the wake)
  uniform float uDensity;       // 0..1 quality: share of ribbons / puffs drawn
  uniform float uTime;
  uniform sampler2D uPath;      // ${PATH_N} × ${MAX_CARS}: the track path behind each car (x, y, z, heading)
  uniform float uPathStep;      // render units between path samples

  vec4 pathTexel(float car, float i) {
    return texture2D(uPath, vec2((i + 0.5) / ${PATH_N}.0, (car + 0.5) / ${MAX_CARS}.0));
  }
  // point on the car's own path sr render units behind the car centre (negative = ahead)
  vec4 pathAt(float car, float sr) {
    if (sr <= 0.0) {
      vec4 p0 = pathTexel(car, 0.0);
      return vec4(p0.xyz + vec3(sin(p0.w), 0.0, cos(p0.w)) * (-sr), p0.w);
    }
    float f = sr / uPathStep;
    float i = min(floor(f), ${PATH_N - 2}.0);
    float t = f - i;
    vec4 a = pathTexel(car, i);
    vec4 b = pathTexel(car, i + 1.0);
    float dh = b.w - a.w;
    dh -= 6.2831853 * floor((dh + 3.14159265) / 6.2831853);
    return vec4(mix(a.xyz, b.xyz, t), a.w + dh * t);
  }
  // car-local metres: sBehind along the path, off = (lateral, + = car's left; height)
  vec3 wakePoint(float car, float sc, float sBehind, vec2 off) {
    float m = 0.55 * sc;
    vec4 p = pathAt(car, sBehind * m);
    vec3 lat = vec3(cos(p.w), 0.0, -sin(p.w));
    return p.xyz + lat * off.x * m + vec3(0.0, off.y * m, 0.0);
  }
  float wobble(float s, float t, float seed) {
    return sin(s * 0.8 + t * 2.3 + seed * 13.0) * 0.6 + sin(s * 1.45 - t * 1.9 + seed * 7.0) * 0.4;
  }
`;

const RIBBON_VS = /* glsl */ `
  attribute vec2 aUV;
  attribute float aCar;
  attribute float aKind;
  attribute float aSide;
  attribute float aSeed;
  varying float vV;
  varying float vAlpha;
  varying float vDirty;
  varying float vFlow;
  ${COMMON}

  // kind 0/3: tip vortex (3 = secondary strand), 1: upwash plume, 2: front-tyre outwash
  vec3 ribbonLocal(float s, float len, float kind, float side, float seed, float spd, float dirty) {
    float turb = (0.02 + 0.07 * spd) * smoothstep(0.0, len, s) * (0.6 + 3.0 * dirty);
    vec2 off;
    float z0 = -2.55; // rear wing trailing edge (car-local metres, scaled by the car group)
    if (kind < 0.5 || kind > 2.5) {
      float strand = kind > 2.5 ? 1.0 : 0.0;
      float r = (0.06 + 0.16 * smoothstep(0.0, 7.0, s)) * (0.6 + 0.6 * spd) * (1.0 + strand * 0.6) * (1.0 + 0.8 * dirty);
      float ang = side * (s * 0.5 - uTime * (1.2 + 3.0 * spd)) + seed * 6.2831 + strand * 2.1;
      off = vec2(side * (0.78 - 0.18 * smoothstep(0.0, 9.0, s)), 0.95 + 0.12 * smoothstep(0.0, 9.0, s));
      off += r * vec2(cos(ang), sin(ang));
    } else if (kind < 1.5) {
      z0 = -2.6; // diffuser exit / beam wing
      off = vec2(side * 0.42 * (1.0 + 0.12 * s), 0.3 + 1.1 * (1.0 - exp(-s / 3.5)));
    } else {
      z0 = 1.65; // front axle
      off = vec2(side * (1.05 + 0.45 * s), 0.35 + 0.06 * s);
    }
    off += turb * vec2(wobble(s, uTime, seed), wobble(s + 3.1, uTime * 1.2, seed + 0.37));
    return vec3(s - z0, off);
  }

  void main() {
    int ci = int(aCar + 0.5);
    vec4 B = uB[ci];
    vec4 C = uC[ci];
    float spd = clamp(B.x, 0.0, 1.2);
    float loss = B.y;
    float weight = B.w;
    if (weight < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float sc = C.y;
    float heat = C.x;
    // adaptive quality: the secondary strands go first, then the outwash trails
    if ((aKind > 2.5 && uDensity < 0.75) || (aKind > 1.5 && aKind < 2.5 && uDensity < 0.4)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // wake length (car-local metres): longer at speed; reaches a follower in the dirty air
    float len = 7.0 + 18.0 * spd;
    if (B.z > 0.0) len = mix(len, max(len, B.z / (0.55 * sc)), smoothstep(0.0, 0.25, loss));
    if (aKind > 1.5 && aKind < 2.5) len = 4.5 + 2.5 * spd;
    float u = aUV.x;
    float s = u * len;
    // turbulence follows the downforce loss; the warm colour only the (pack-capped) heat
    float ramp = smoothstep(0.0, 0.55, u) * (step(aKind, 1.5) + 0.5 * step(2.5, aKind));
    float dirty = loss * ramp * 0.6;
    vec3 l0 = ribbonLocal(s, len, aKind, aSide, aSeed, spd, dirty);
    vec3 l1 = ribbonLocal(s + 0.25, len, aKind, aSide, aSeed, spd, dirty);
    vec3 p0 = wakePoint(aCar, sc, l0.x, l0.yz);
    vec3 p1 = wakePoint(aCar, sc, l1.x, l1.yz);
    vec3 tang = normalize(p1 - p0 + vec3(1e-5));
    vec3 toCam = normalize(cameraPosition - p0);
    vec3 across = normalize(cross(tang, toCam) + vec3(1e-5, 0.0, 0.0));
    float w = (aKind > 0.5 && aKind < 1.5 ? 0.09 : 0.05) * (0.6 + u * 1.2) * sc * (1.0 + dirty * 0.6);
    vec3 pos = p0 + across * aUV.y * w;
    vV = aUV.y;
    float fadeIn = smoothstep(0.0, 0.06, u);
    float base = aKind > 2.5 ? 0.45 : (aKind > 1.5 ? 0.55 : (aKind > 0.5 ? 0.7 : 0.9));
    // clean air fades out behind the car; a wake that reaches a follower stays visible up to its nose
    float tail = mix(pow(1.0 - u, 1.15), 1.0 - smoothstep(0.88, 1.0, u), smoothstep(0.0, 0.3, loss) * step(aKind, 1.5));
    // translucent: the wake is a hint, not a paint stroke
    vAlpha = 0.45 * weight * base * fadeIn * tail * (0.25 + 0.75 * smoothstep(0.05, 0.6, spd)) * (1.0 + 0.5 * heat * ramp);
    vDirty = clamp(heat * ramp, 0.0, 1.0);
    vFlow = s * 0.22 - uTime * (0.9 + 2.6 * spd) + aSeed * 3.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }
`;

const RIBBON_FS = /* glsl */ `
  varying float vV;
  varying float vAlpha;
  varying float vDirty;
  varying float vFlow;
  uniform vec3 uClean;
  uniform vec3 uDirty;
  void main() {
    float f = fract(vFlow);
    float streak = smoothstep(0.0, 0.18, f) * smoothstep(1.0, 0.5, f);
    float edge = 1.0 - vV * vV;
    float a = vAlpha * edge * (0.3 + 0.7 * streak);
    if (a < 0.004) discard;
    vec3 col = mix(uClean, uDirty, vDirty);
    col = mix(col, vec3(1.0), 0.25 * streak * edge * (1.0 - vDirty));
    gl_FragColor = vec4(col, min(a, 0.8));
  }
`;

const PUFF_VS = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aCar;
  attribute float aSeed;
  attribute float aPhase;
  varying vec2 vC;
  varying float vAlpha;
  varying float vDirty;
  ${COMMON}
  void main() {
    int ci = int(aCar + 0.5);
    vec4 B = uB[ci];
    vec4 C = uC[ci];
    float spd = clamp(B.x, 0.0, 1.2);
    float loss = B.y;
    float weight = B.w;
    if (weight < 0.01 || spd < 0.03 || aSeed - floor(aSeed) > uDensity * 0.49 + 0.005) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float sc = C.y;
    float heat = C.x;
    float len = 6.0 + 16.0 * spd;
    if (B.z > 0.0) len = mix(len, max(len, B.z / (0.55 * sc)), smoothstep(0.0, 0.25, loss));
    float u = fract(aPhase + uTime * (0.18 + 0.55 * spd));
    float s = u * len;
    float core = aSeed > 0.5 ? 1.0 : -1.0;
    float ang = uTime * (2.0 + 6.0 * spd) * core + aSeed * 40.0 + s * 0.8;
    float r = 0.18 + 0.09 * s;
    vec2 off = vec2(core * (0.55 - 0.1 * smoothstep(0.0, 8.0, s)), 0.75 + 0.5 * (1.0 - exp(-s / 3.0)));
    off += r * vec2(cos(ang), sin(ang)) * (0.6 + 0.8 * loss);
    off += (0.05 + 0.12 * loss) * vec2(wobble(s, uTime, aSeed), wobble(s + 1.7, uTime, aSeed + 0.5));
    vec3 c = wakePoint(aCar, sc, s + 2.4, off);
    float size = (0.2 + 0.035 * s) * sc * (0.75 + 0.6 * loss);
    vec4 mv = viewMatrix * vec4(c, 1.0);
    mv.xy += aCorner * size;
    vC = aCorner;
    float life = smoothstep(0.0, 0.12, u) * mix(1.0 - u, 1.0 - smoothstep(0.85, 1.0, u), smoothstep(0.0, 0.3, loss));
    vAlpha = weight * life * (0.025 + 0.035 * loss + 0.07 * heat) * smoothstep(0.05, 0.5, spd);
    vDirty = clamp(heat * smoothstep(0.0, 0.7, u), 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const PUFF_FS = /* glsl */ `
  varying vec2 vC;
  varying float vAlpha;
  varying float vDirty;
  uniform vec3 uClean;
  uniform vec3 uDirty;
  void main() {
    float d = dot(vC, vC);
    if (d > 1.0) discard;
    float a = vAlpha * (1.0 - d) * (1.0 - d);
    vec3 col = mix(mix(uClean, vec3(1.0), 0.45), uDirty, vDirty);
    gl_FragColor = vec4(col, a);
  }
`;

function ribbonGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  const uv = new Float32Array((S + 1) * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i <= S; i++) {
    uv.set([i / S, -1, i / S, 1], i * 4);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  g.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
  // position is required by three for draw-range bookkeeping; the shader ignores it
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((S + 1) * 2 * 3), 3));
  g.setIndex(idx);
  const count = MAX_CARS * RIBBONS;
  const car = new Float32Array(count);
  const kind = new Float32Array(count);
  const side = new Float32Array(count);
  const seed = new Float32Array(count);
  const layout: [number, number][] = [
    [0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1], [3, -1], [3, 1],
  ];
  for (let c = 0; c < MAX_CARS; c++)
    for (let r = 0; r < RIBBONS; r++) {
      const k = c * RIBBONS + r;
      car[k] = c;
      kind[k] = layout[r][0];
      side[k] = layout[r][1];
      seed[k] = ((c * 7 + r * 13) % 17) / 17;
    }
  g.setAttribute('aCar', new THREE.InstancedBufferAttribute(car, 1));
  g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  g.setAttribute('aSide', new THREE.InstancedBufferAttribute(side, 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = count;
  return g;
}

function puffGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const count = MAX_CARS * PUFFS;
  const car = new Float32Array(count);
  const seed = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let c = 0; c < MAX_CARS; c++)
    for (let p = 0; p < PUFFS; p++) {
      const k = c * PUFFS + p;
      car[k] = c;
      seed[k] = (p % 2) + ((p * 0.618 + c * 0.31) % 1) * 0.49;
      phase[k] = (p / PUFFS + c * 0.137) % 1;
    }
  g.setAttribute('aCar', new THREE.InstancedBufferAttribute(car, 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  g.instanceCount = count;
  return g;
}

export function Airflow({ scene, density = 1 }: { scene: RaceScene; density?: number }) {
  const enabled = useReplayPrefs((s) => s.airflow);
  const ribbons = useRef<THREE.Mesh>(null);
  const puffs = useRef<THREE.Mesh>(null);

  const res = useMemo(() => {
    const pathData = new Float32Array(PATH_N * MAX_CARS * 4);
    const pathTex = new THREE.DataTexture(pathData, PATH_N, MAX_CARS, THREE.RGBAFormat, THREE.FloatType);
    pathTex.minFilter = pathTex.magFilter = THREE.NearestFilter;
    pathTex.needsUpdate = true;
    const uniforms = {
      uPath: { value: pathTex },
      uPathStep: { value: PATH_LEN / (PATH_N - 1) },
      uB: { value: Array.from({ length: MAX_CARS }, () => new THREE.Vector4()) },
      uC: { value: Array.from({ length: MAX_CARS }, () => new THREE.Vector4()) },
      uTime: { value: 0 },
      // clean air: soft blue-white · dirty air (a follower genuinely inside the wake): warm amber
      uClean: { value: new THREE.Color('#9CC8F2') },
      uDirty: { value: new THREE.Color('#FF8A3D') },
      uDensity: { value: 1 },
    };
    const common = { uniforms, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide } as const;
    const ribbonMat = new THREE.ShaderMaterial({ ...common, vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS });
    const puffMat = new THREE.ShaderMaterial({ ...common, vertexShader: PUFF_VS, fragmentShader: PUFF_FS });
    return { uniforms, ribbonMat, puffMat, ribbonGeo: ribbonGeometry(), puffGeo: puffGeometry(), pathData, pathTex };
  }, []);

  useEffect(
    () => () => {
      res.ribbonMat.dispose();
      res.puffMat.dispose();
      res.ribbonGeo.dispose();
      res.puffGeo.dispose();
      res.pathTex.dispose();
    },
    [res],
  );

  useFrame((_, dt) => {
    const air = frame.air;
    const u = res.uniforms;
    if (useRaceLab.getState().playing) u.uTime.value += Math.min(dt, 0.1);
    u.uDensity.value = density;
    const m = scene.model;
    const n = m.n;
    const step = PATH_LEN / (PATH_N - 1);
    const pd = res.pathData;
    for (let i = 0; i < MAX_CARS; i++) {
      const on = i < air.count && air.weight[i] > 0;
      u.uB.value[i].set(air.speed[i], air.loss[i], air.follow[i], on ? air.weight[i] : 0);
      u.uC.value[i].set(air.heat[i], air.scale, 0, 0);
      if (!on || !enabled) continue;
      // the track path behind the car, at the car's current lateral offset
      for (let k = 0; k < PATH_N; k++) {
        const f = (air.s[i] - k * step) / m.ds;
        const i0 = Math.floor(f);
        const w = f - i0;
        const a = ((i0 % n) + n) % n;
        const b = (a + 1) % n;
        const tx = m.tx[a] + (m.tx[b] - m.tx[a]) * w;
        const tz = m.tz[a] + (m.tz[b] - m.tz[a]) * w;
        const o = (i * PATH_N + k) * 4;
        const d = air.d[i];
        if (k === 0) {
          // anchor exactly on the drawn car (it may be yawed / scaled)
          pd[o] = air.pos[i * 3];
          pd[o + 1] = air.pos[i * 3 + 1];
          pd[o + 2] = air.pos[i * 3 + 2];
          pd[o + 3] = air.yaw[i];
        } else {
          pd[o] = m.px[a] + (m.px[b] - m.px[a]) * w + -tz * d;
          pd[o + 1] = m.py[a] + (m.py[b] - m.py[a]) * w + 0.02;
          pd[o + 2] = m.pz[a] + (m.pz[b] - m.pz[a]) * w + tx * d;
          pd[o + 3] = Math.atan2(tx, tz);
        }
      }
    }
    res.pathTex.needsUpdate = true;
  });

  return (
    <group visible={enabled}>
      <mesh ref={ribbons} geometry={res.ribbonGeo} material={res.ribbonMat} frustumCulled={false} renderOrder={5} />
      <mesh ref={puffs} geometry={res.puffGeo} material={res.puffMat} frustumCulled={false} renderOrder={4} />
    </group>
  );
}
