import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative asset URLs let the same build run from a domain root or from a subpath such as /repo/.
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', spike: 'spike.html' },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
})
