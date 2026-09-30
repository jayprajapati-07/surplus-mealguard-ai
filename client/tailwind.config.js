/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        navy: {
          900: '#0B1F33',
          800: '#102A45',
          700: '#18385A',
        },
        brand: {
          topbar: '#004C35',
          green: '#006B48',
          emerald: '#059669',
          dark: '#0C2741',
          surface: '#F6FAF7',
          border: '#E5ECE8',
          blue: '#1565C0',
          steel: '#4F6D7A',
          slate: '#607D8B',
          teal: '#00897B',
          warm: '#F5E6C8',
          offwhite: '#F5F7FA',
        },
        leaf: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
      },
    },
  },
  plugins: [],
};
