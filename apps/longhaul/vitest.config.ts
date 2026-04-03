import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { transformWithEsbuild } from 'vite'

export default defineConfig({
  plugins: [
    // Treat .js files as JSX so the legacy CRA-style source files parse correctly.
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null
        return transformWithEsbuild(code, id, { loader: 'jsx' })
      },
    },
    react(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
    // App.test.jsx is a vestigial CRA boilerplate placeholder — it tests
    // "learn react link" (default CRA text) and requires a full Redux store
    // + React Router setup that was never provided.
    exclude: ['**/App.test.*', '**/node_modules/**'],
  },
})
