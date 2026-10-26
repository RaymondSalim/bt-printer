import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', spike: 'spike.html' },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
})
