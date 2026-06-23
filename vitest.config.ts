import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Main/shared tests run in node; renderer component tests (.test.tsx) get jsdom.
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']]
  }
})
