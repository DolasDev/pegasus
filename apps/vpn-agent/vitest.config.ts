import { defineConfig } from 'vitest/config'

// Exclude compiled test output so `npm run build` artifacts don't get
// re-discovered as tests (the .js files re-import vitest via require()
// and crash on load).
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
