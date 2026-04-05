import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
    // App.test.jsx is a vestigial CRA boilerplate placeholder — it tests
    // "learn react link" (default CRA text) and requires a full Redux store
    // + React Router setup that was never provided.
    exclude: ['**/App.test.*', '**/node_modules/**'],
  },
})
