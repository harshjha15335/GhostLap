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
        paper: '#0B0E14',       // carbon-asphalt paper
        line: '#232A36',
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
