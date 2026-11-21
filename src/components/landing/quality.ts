export interface Quality {
  mobile: boolean;
  /** touch-first device (no hover) */
  coarse: boolean;
  dpr: [number, number];
  particles: number;
  sparks: number;
  /** use drei MeshReflectorMaterial for the wet asphalt */
  reflector: boolean;
  envResolution: number;
}

export function detectQuality(): Quality {
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const coarse = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches;
  const mobile = coarse || w < 768;
  const lowCores = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
  return {
    mobile,
    coarse,
    dpr: mobile ? [1, 1.5] : [1, 1.75],
    particles: mobile ? 260 : 900,
    sparks: mobile ? 60 : 220,
    reflector: !mobile && !lowCores,
    envResolution: mobile ? 64 : 128,
  };
}
