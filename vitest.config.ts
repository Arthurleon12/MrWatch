import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // every test here is a pure function or a localStorage-backed store —
    // no DOM needed, so the fast environment is the right one
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
})
