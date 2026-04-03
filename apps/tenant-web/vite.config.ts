import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pegasus/domain': path.resolve(__dirname, '../domain/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
})
