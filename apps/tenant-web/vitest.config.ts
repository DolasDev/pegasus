import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Pin react and react-dom to the workspace root copies so that source files
      // and @testing-library (which resolves from root via Node) share one instance.
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      '@pegasus/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
})
