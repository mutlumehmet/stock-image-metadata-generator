/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0e1117',
        card: '#161b26',
        card2: '#1c2235',
        border: '#252d42',
        text: '#e0e4f0',
        text2: '#8892aa',
        text3: '#404860',
        accent: '#4070f4',
        accentH: '#2d5de0',
        input: '#12161f',
        sel: '#1a2440',
        hover: '#1a2030',
        green: '#22c55e',
        greenBg: '#0f2318',
      },
    },
  },
  plugins: [],
}
