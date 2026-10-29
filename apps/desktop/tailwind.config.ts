import type { Config } from 'tailwindcss'
import turbothemes from 'turbothemes/tailwind'

export default {
  presets: [turbothemes], // colour names (bg, surface, accent...), rounded-theme and font-sans come from the themes
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
} satisfies Config
