import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/domain/vitest.config.ts',
  'packages/api/vitest.config.ts',
])
