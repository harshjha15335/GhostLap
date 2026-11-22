/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        asphalt: '#080B10',     // deep asphalt base
        panel: '#10151F',       // elevated pit-wall panels
        track: '#141820',       // track ribbon
        neon: '#D4FF00',        // Pirelli-neon chartreuse
        crimson: '#FF1E1E',     // soft-tyre crimson
        ghost: '#00F5D4',       // ghost car cyan
        amber: '#FF7A00',       // dirty-air warning amber
        line: '#232A36',
        // Colourful "paper" theme (sweet-tape style flat colours). `bg-paper` keeps the old
        // carbon-asphalt meaning; `bg-paper-lime` etc. are the bright sheets.
        paper: {
          DEFAULT: '#0B0E14',   // carbon-asphalt paper (legacy)
          lime: '#D4FF00',
          green: '#0A3A12',     // deep racing green
          'green-deep': '#062A0C',
          orange: '#FF7A00',
          'orange-deep': '#E5650A',
          yellow: '#FFD400',
          blue: '#2C5CFF',      // blueprint blue
          'blue-deep': '#1C3FC4',
          lilac: '#B9A6FF',
          sky: '#8FD3FF',
        },
        cream: { DEFAULT: '#F6F1E3', light: '#FFFCF3', dark: '#E8E0CA' },
        ink: { DEFAULT: '#0F1A12', soft: '#545B51' },
        // AA-safe (≥ 4.5:1 on cream / white / lime) text versions of the accent colours
        'ink-teal': '#00725F',
        'ink-red': '#C8102E',
        'ink-amber': '#9C4400',
        'ink-green': '#0A6B2A',
        'ink-blue': '#1D47D6',
      },
      boxShadow: {
        // hard, offset "sticker" drop shadows with an ink keyline colour
        'sticker-sm': '2px 3px 0 0 #0F1A12',
        sticker: '4px 5px 0 0 #0F1A12',
        'sticker-lg': '8px 10px 0 0 #0F1A12',
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
