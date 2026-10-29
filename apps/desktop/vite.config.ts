import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: path.resolve(__dirname, 'out/renderer'), emptyOutDir: true },
})
