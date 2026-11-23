/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        asphalt: '#080B10',     // deep asphalt base
        panel: '#10151F',       // elevated pit-wall panels
        track: '#141820',       // track ribbon
        neon: '#D4FF00',        // logo chartreuse (Logo.tsx only - not a theme colour any more)
        crimson: '#FF1E1E',     // soft-tyre crimson
        ghost: '#00F5D4',       // ghost car cyan
        amber: '#FF7A00',       // dirty-air warning amber
        line: '#232A36',
        // "Pit-Lane Pop" theme: flat, saturated pop-art sheets on warm chalk, midnight-plum
        // ink keylines and a halftone-dot surface motif (see src/styles/index.css).
        pop: {
          blue: '#2D3BFF',      // electric ultramarine - dominant sheet colour
          'blue-deep': '#1A22C4',
          pink: '#FF2E88',      // hot magenta - primary accent / CTAs (ink text)
          'pink-deep': '#D1146B',
          sun: '#FFD23F',       // sunshine yellow - highlights / badges
          'sun-deep': '#F2B400',
          uv: '#7A2CFF',        // ultraviolet - secondary sheet (chalk text)
          'uv-deep': '#5214D1',
          papaya: '#FF8A3D',    // minor accent
          sky: '#9ED8FF',       // pale sky for light panels / 3D skies
        },
        // legacy alias still used by a file outside this theme pass (SeasonStage.tsx)
        paper: { DEFAULT: '#0B0E14', yellow: '#FFD23F' },
        // warm chalk base (name kept from the previous theme so every usage compiles)
        cream: { DEFAULT: '#FFF7EE', light: '#FFFCF8', dark: '#F2E6D9' },
        ink: { DEFAULT: '#170F33', soft: '#5A5470' },
        // AA-safe (>= 4.5:1 on chalk / white) text versions of the accent colours
        'ink-teal': '#00725F',
        'ink-red': '#C8102E',
        'ink-amber': '#9C4400',
        'ink-green': '#0A6B2A',
        'ink-blue': '#2D3BFF',
        'ink-pink': '#C2005C',
        'ink-uv': '#5A14E0',
      },
      boxShadow: {
        // hard, offset "sticker" drop shadows in ink, plus coloured pop variants
        'sticker-sm': '2px 3px 0 0 #170F33',
        sticker: '4px 5px 0 0 #170F33',
        'sticker-lg': '8px 10px 0 0 #170F33',
        'pop-pink': '4px 5px 0 0 #FF2E88',
        'pop-blue': '4px 5px 0 0 #2D3BFF',
      },
      fontFamily: {
        display: ['"Anton"', 'Impact', 'system-ui', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
