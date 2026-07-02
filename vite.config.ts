import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

// GitHub Pages serves the app under /<repo>/. Allow overriding the base for
// other hosts (e.g. root deploys) via the BASE_PATH env var.
const base = process.env.BASE_PATH ?? '/claurdalie/'

export default defineConfig({
  base,
  plugins: [react()],
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
