/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0d1117',
        panel: '#161b22',
        border: '#30363d',
        accent: '#58a6ff',
        claude: '#d97757',
        gemini: '#4285f4'
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
