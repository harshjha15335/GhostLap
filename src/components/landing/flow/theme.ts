/**
 * Palette + shared CSS for the DOM-driven "pit exit" flow that follows the
 * 3D chapters (orange strategist → chartreuse every-lap scroller → CTA → footer).
 */

export const C = {
  orange: '#FF7A00',
  orangeDeep: '#E5650A',
  yellow: '#FFD400',
  neon: '#D4FF00',
  green: '#0A3A12',
  greenDeep: '#062A0C',
  asphalt: '#080B10',
  panel: '#10151F',
  ghost: '#00F5D4',
  crimson: '#FF1E1E',
  lilac: '#B9A6FF',
  violet: '#6B4BFF',
  paper: '#F4F1E8',
};

export type CompoundKey = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET';

export const COMPOUND_STYLE: Record<CompoundKey, { color: string; letter: string; ink: string; tagline: string }> = {
  SOFT: { color: '#FF1E1E', letter: 'S', ink: '#FFFFFF', tagline: 'FAST · FRAGILE · QUALI HERO' },
  MEDIUM: { color: '#FFD400', letter: 'M', ink: '#080B10', tagline: 'THE ALL-ROUNDER · ONE-STOP' },
  HARD: { color: '#F2F2F2', letter: 'H', ink: '#080B10', tagline: 'LONG RUNS · SLOW TO WARM' },
  INTER: { color: '#2BD14B', letter: 'I', ink: '#080B10', tagline: 'DAMP TRACK · DRYING LINE' },
  WET: { color: '#1E8BFF', letter: 'W', ink: '#FFFFFF', tagline: 'STANDING WATER · FULL WET' },
};

// Crumpled-paper relief (diffuse-lit fractal noise) and fine grain, inline SVG — no downloads.
const crumple = `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='720'><filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.0065' numOctaves='5' seed='11' stitchTiles='stitch'/><feDiffuseLighting lighting-color='#fff' surfaceScale='2.6'><feDistantLight azimuth='225' elevation='52'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>`;
const grain = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;
const uri = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

export const FLOW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap');
.fl-paper { position:absolute; inset:0; pointer-events:none; background-image:${uri(crumple)}; background-size:720px 720px; mix-blend-mode:multiply; opacity:.34; }
.fl-grain { position:absolute; inset:0; pointer-events:none; background-image:${uri(grain)}; background-size:240px 240px; mix-blend-mode:multiply; opacity:.16; }
.fl-hand { font-family:'Caveat','Bradley Hand','Segoe Print','Comic Sans MS',cursive; }
.fl-squircle { border-radius: 26% / 26%; }
.fl-tape { position:absolute; background: linear-gradient(180deg, rgba(222,203,160,.92), rgba(205,184,139,.9)); box-shadow: 0 1px 2px rgba(0,0,0,.18); clip-path: polygon(2% 6%, 98% 0, 100% 92%, 0 100%); }
.fl-tape.dark { background: linear-gradient(180deg, #2b2f36, #1b1e23); }
.fl-pill { display:inline-flex; align-items:center; gap:.5em; border-radius:6px; font-family:'Anton',Impact,sans-serif; text-transform:uppercase; letter-spacing:.02em; line-height:1; white-space:nowrap; }
.fl-pill::before { content:''; width:3px; height:.9em; background-image: radial-gradient(circle, currentColor 1px, transparent 1.2px); background-size:3px 4px; opacity:.7; }
.fl-will { will-change: transform; }
.fl-spin { animation: fl-spin 14s linear infinite; }
.fl-spin-slow { animation: fl-spin 40s linear infinite; }
@keyframes fl-spin { to { transform: rotate(360deg); } }
.fl-bob { animation: fl-bob 4.2s ease-in-out infinite; }
@keyframes fl-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
.fl-draw path.fl-ink { stroke-dasharray: var(--len, 600); stroke-dashoffset: calc(var(--len, 600) * (1 - var(--draw, 1))); }
.fl-link { transition: transform .35s cubic-bezier(.2,.8,.2,1), filter .35s; }
.fl-link:hover { transform: translateY(-3px) rotate(-1deg); }
.fl-word:hover .fl-verb { -webkit-text-stroke: 0; color: transparent; -webkit-text-stroke-width: 3px; -webkit-text-stroke-color: ${C.green}; }
.fl-nav a { position:relative; }
.fl-nav a::after { content:''; position:absolute; left:50%; bottom:-14px; width:8px; height:8px; margin-left:-4px; border-radius:50%; background:${C.neon}; transition: transform .3s; }
.fl-nav a:hover::after { transform: scale(1.8); }
.fl-body { touch-action:none; user-select:none; -webkit-user-select:none; }
@media (prefers-reduced-motion: reduce) {
  .fl-spin, .fl-spin-slow, .fl-bob { animation: none; }
}
`;
