/**
 * Palette + shared CSS for the DOM-driven "pit exit" flow that follows the 3D chapters
 * (ultramarine strategist -> hot-magenta every-lap scroller -> CTA -> ultraviolet footer).
 * "Pit-Lane Pop": flat saturated sheets, midnight-plum ink, halftone dots, chequer tabs.
 */

export const C = {
  blue: '#2D3BFF',
  blueDeep: '#1A22C4',
  pink: '#FF2E88',
  pinkDeep: '#D1146B',
  sun: '#FFD23F',
  sunDeep: '#F2B400',
  uv: '#7A2CFF',
  uvDeep: '#5214D1',
  papaya: '#FF8A3D',
  sky: '#9ED8FF',
  ink: '#170F33',
  cream: '#FFF7EE',
  asphalt: '#080B10',
  panel: '#10151F',
  ghost: '#00F5D4',
  crimson: '#FF1E1E',
};

export type CompoundKey = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET';

export const COMPOUND_STYLE: Record<CompoundKey, { color: string; letter: string; ink: string; tagline: string }> = {
  SOFT: { color: '#FF1E1E', letter: 'S', ink: '#FFFFFF', tagline: 'FAST · FRAGILE · QUALI HERO' },
  MEDIUM: { color: '#FFD400', letter: 'M', ink: '#080B10', tagline: 'THE ALL-ROUNDER · ONE-STOP' },
  HARD: { color: '#F2F2F2', letter: 'H', ink: '#080B10', tagline: 'LONG RUNS · SLOW TO WARM' },
  INTER: { color: '#2BD14B', letter: 'I', ink: '#080B10', tagline: 'DAMP TRACK · DRYING LINE' },
  WET: { color: '#1E8BFF', letter: 'W', ink: '#FFFFFF', tagline: 'STANDING WATER · FULL WET' },
};

export const FLOW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap');
.fl-hand { font-family:'Caveat','Bradley Hand','Segoe Print','Comic Sans MS',cursive; }
.fl-squircle { border-radius: 26% / 26%; }
.fl-tape { position:absolute; background: conic-gradient(${C.ink} 25%, ${C.cream} 0 50%, ${C.ink} 0 75%, ${C.cream} 0) 0 0 / 10px 10px; border: 2px solid ${C.ink}; border-radius: 3px; box-shadow: 2px 3px 0 rgba(23,15,51,.35); }
.fl-tape.dark { background: conic-gradient(${C.ink} 25%, ${C.pink} 0 50%, ${C.ink} 0 75%, ${C.pink} 0) 0 0 / 10px 10px; }
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
.fl-tag { opacity: 0; transition: opacity .25s; }
.fl-word:hover .fl-tag, .fl-word:focus-visible .fl-tag { opacity: 1; }
.fl-word:hover .fl-verb { -webkit-text-stroke: 0; color: transparent; -webkit-text-stroke-width: 3px; -webkit-text-stroke-color: ${C.ink}; }
.fl-nav a { position:relative; }
.fl-nav a::after { content:''; position:absolute; left:50%; bottom:-14px; width:8px; height:8px; margin-left:-4px; border-radius:50%; background:${C.pink}; transition: transform .3s; }
.fl-nav a:hover::after { transform: scale(1.8); }
.fl-body { touch-action:none; user-select:none; -webkit-user-select:none; }
@media (prefers-reduced-motion: reduce) {
  .fl-spin, .fl-spin-slow, .fl-bob { animation: none; }
}
`;
