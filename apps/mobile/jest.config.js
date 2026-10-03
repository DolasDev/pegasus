// Skip @testing-library/react-native peer dep check — monorepo hoisting
// puts react-test-renderer in root node_modules, not local.
process.env.RNTL_SKIP_DEPS_CHECK = 'true'

const path = require('path')

// Resolve a package from mobile's local node_modules first, then monorepo root.
// Needed because npm workspace hoisting is unpredictable.
function resolvePackage(name) {
  const local = path.join(__dirname, 'node_modules', name)
  const root = path.join(__dirname, '..', '..', 'node_modules', name)
  try {
    require.resolve(path.join(local, 'package.json'))
    return local
  } catch {
    return root
  }
}

module.exports = {
  preset: 'react-native',
  // Override the preset's testEnvironment (react-native pins its own
  // jest-environment-node@^29, incompatible with jest >= 30.4's runtime).
  // See jest.environment.js for the details.
  testEnvironment: require.resolve('./jest.environment.js'),
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-async-storage|expo|@expo|expo-status-bar|expo-router|expo-constants|expo-image-picker|expo-file-system|expo-print|expo-document-picker|expo-linking|expo-secure-store|react-native-web|react-native-safe-area-context|react-native-screens|react-native-get-random-values|react-native-document-scanner-plugin)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // 15s was already a raise from Jest's 5s default and it is still marginal on a CI runner.
  // TENANT-03 in __tests__/app/(auth)/tenant-picker.test.tsx runs in ~1s locally and exceeded 15s
  // in CI twice on 2026-10-03 — a ~15x slowdown, so starvation and cold-start rather than a hang
  // (it is a mocked press with a resolved promise; nothing in it can block). In the same runs
  // login.test.tsx passed while taking ~50s for the file, which is the corroborating signal.
  //
  // Turbo runs `test` in PARALLEL across every package with the cache disabled, so the budget any
  // one package needs depends on what the others are doing. The run that first tripped this added
  // two TypeScript-compiler-API tests in packages/domain-reference — about ten seconds of CPU —
  // and a 15s budget had no room for it. Any package adding CPU-bound tests would have done the
  // same, which is why the fix belongs here rather than in that package.
  //
  // The budget exists to stop a hang, not to police a slow runner. Same reasoning, and the same
  // conclusion, as `SLOW_MS` in packages/domain-reference/tests/conformance/catalog.test.ts.
  testTimeout: 45000,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/*.test.{ts,tsx}',
    '!**/__tests__/**',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pegasus/theme$': '<rootDir>/../../packages/theme/src/index.ts',
    '^@pegasus/api-http$': '<rootDir>/../../packages/api-http/src/index.ts',
    '^@pegasus/domain$': '<rootDir>/../../packages/domain/src/index.ts',
    // Resolve from local node_modules first (pinned versions), then root (hoisted).
    '^react$': resolvePackage('react'),
    '^react/(.*)$': resolvePackage('react') + '/$1',
    '^react-dom$': resolvePackage('react-dom'),
    '^react-dom/(.*)$': resolvePackage('react-dom') + '/$1',
    '^react-test-renderer$': resolvePackage('react-test-renderer'),
    '^react-test-renderer/(.*)$': resolvePackage('react-test-renderer') + '/$1',
    '^react-native$': resolvePackage('react-native'),
    '^react-native/(.*)$': resolvePackage('react-native') + '/$1',
  },
}
