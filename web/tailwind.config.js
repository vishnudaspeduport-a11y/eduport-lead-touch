/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // chart chrome tokens (see src/lib/palette.ts) exposed as utilities
        surface: { DEFAULT: 'rgb(var(--surface) / <alpha-value>)', 2: 'rgb(var(--surface-2) / <alpha-value>)' },
        ink: { DEFAULT: 'rgb(var(--ink) / <alpha-value>)', 2: 'rgb(var(--ink-2) / <alpha-value>)', 3: 'rgb(var(--ink-3) / <alpha-value>)' },
        line: 'rgb(var(--line) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'] },
    },
  },
  plugins: [],
};
