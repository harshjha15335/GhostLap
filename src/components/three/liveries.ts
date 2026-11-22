import * as THREE from 'three';

/**
 * Team livery schemes for the procedural F1Car and DriverFigure.
 *
 * Colours are approximations of each team's 2026 livery layout (no sponsor logos —
 * logos can be supplied later through F1Car's `logoTexture` decal slots).
 *
 * Patterns (zones are computed in the body shader from car-space position, so they cost
 * no extra geometry, materials or draw calls):
 *   solid   primary everywhere
 *   split   primary upper body, secondary lower flanks / sidepod undercut
 *   stripe  primary body with a secondary centre stripe along nose + engine cover
 *           and an accent pinstripe beside it
 *   fade    primary at the nose fading to secondary at the rear
 * Wing top surfaces and the halo take `accent`.
 */
export type LiveryPattern = 'solid' | 'split' | 'stripe' | 'fade';

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  pattern?: LiveryPattern;
}

export const LIVERIES: Record<string, Livery> = {
  mercedes: { primary: '#C6CBD0', secondary: '#0E0F11', accent: '#00D7B6', pattern: 'fade' },
  ferrari: { primary: '#DC0000', secondary: '#121212', accent: '#F4F4F4', pattern: 'split' },
  'red-bull-racing': { primary: '#1B2552', secondary: '#D7192C', accent: '#FFC906', pattern: 'stripe' },
  mclaren: { primary: '#FF8000', secondary: '#1B1D21', accent: '#FF8000', pattern: 'split' },
  'racing-bulls': { primary: '#F2F4F7', secondary: '#1634CB', accent: '#E8002D', pattern: 'split' },
  alpine: { primary: '#0A67C9', secondary: '#FF5BC8', accent: '#0B0D12', pattern: 'fade' },
  'haas-f1-team': { primary: '#F1F2F3', secondary: '#25272B', accent: '#E6002B', pattern: 'split' },
  audi: { primary: '#A5AAAF', secondary: '#121314', accent: '#F50537', pattern: 'split' },
  williams: { primary: '#1868DB', secondary: '#051C3F', accent: '#F2F4F7', pattern: 'fade' },
  'aston-martin': { primary: '#00594F', secondary: '#CEDC00', accent: '#CEDC00', pattern: 'stripe' },
  cadillac: { primary: '#121314', secondary: '#F2F2F2', accent: '#B9BEC4', pattern: 'split' },
};

/** Resolve a livery from a Livery object, a teamId, or fall back to plain colours. */
export function resolveLivery(livery: Livery | string | undefined, color: string, accent: string): Required<Livery> {
  const l = typeof livery === 'string' ? LIVERIES[livery] : livery;
  if (!l) return { primary: color, secondary: color, accent, pattern: 'solid' };
  return { primary: l.primary, secondary: l.secondary, accent: l.accent, pattern: l.pattern ?? 'solid' };
}

const PATTERN_ID: Record<LiveryPattern, number> = { solid: 0, split: 1, stripe: 2, fade: 3 };

/**
 * MeshStandardMaterial whose diffuse colour is chosen per fragment from the livery zones.
 * All instances share one compiled program (customProgramCacheKey); colours live in
 * per-material uniforms, so liveries can change without recompiling.
 */
export function makeLiveryMaterial(l: Required<Livery>, params: THREE.MeshStandardMaterialParameters = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', ...params });
  const uniforms = {
    uLivP: { value: new THREE.Color(l.primary) },
    uLivS: { value: new THREE.Color(l.secondary) },
    uLivA: { value: new THREE.Color(l.accent) },
    uLivPattern: { value: PATTERN_ID[l.pattern] },
  };
  mat.userData.livery = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCarPos;
uniform vec3 uLivP; uniform vec3 uLivS; uniform vec3 uLivA; uniform float uLivPattern;
vec3 liveryColor(vec3 p) {
  vec3 c = uLivP;
  float aa = 0.006;
  if (uLivPattern > 0.5 && uLivPattern < 1.5) {
    // split: lower flanks + sidepod undercut in secondary; line rises toward the rear
    float line = 0.37 + 0.05 * clamp(-p.z, 0.0, 2.0);
    c = mix(uLivS, uLivP, smoothstep(line - aa, line + aa, p.y));
    // nose tip in secondary
    c = mix(c, uLivS, smoothstep(2.45 - aa, 2.45 + aa, p.z));
  } else if (uLivPattern > 1.5 && uLivPattern < 2.5) {
    // stripe: centre band on top + accent pinstripes
    float ax = abs(p.x);
    float top = smoothstep(0.25, 0.3, p.y);
    c = mix(c, uLivS, top * (1.0 - smoothstep(0.075 - aa, 0.075 + aa, ax)));
    float pin = smoothstep(0.075 - aa, 0.075 + aa, ax) * (1.0 - smoothstep(0.095 - aa, 0.095 + aa, ax));
    c = mix(c, uLivA, top * pin);
  } else if (uLivPattern > 2.5) {
    // fade: nose primary → rear secondary
    c = mix(uLivP, uLivS, smoothstep(0.9, -1.1, p.z));
  }
  return c;
}`,
      )
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * liveryColor(vCarPos), opacity );');
  };
  mat.customProgramCacheKey = () => 'ghostlap-livery-v1';
  return mat;
}
