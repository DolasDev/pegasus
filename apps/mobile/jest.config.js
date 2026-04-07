// Skip @testing-library/react-native peer dep check — monorepo hoisting
// puts react-test-renderer in root node_modules, not local.
process.env.RNTL_SKIP_DEPS_CHECK = 'true';

const path = require('path');

// Resolve a package from mobile's local node_modules first, then monorepo root.
// Needed because npm workspace hoisting is unpredictable.
function resolvePackage(name) {
  const local = path.join(__dirname, 'node_modules', name);
  const root = path.join(__dirname, '..', '..', 'node_modules', name);
  try {
    require.resolve(path.join(local, 'package.json'));
    return local;
  } catch {
    return root;
  }
}

module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-async-storage|expo|@expo|expo-status-bar|expo-router|expo-constants|expo-image-picker|expo-linking|expo-secure-store|react-native-web|react-native-safe-area-context|react-native-screens|react-native-get-random-values)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 15000,
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
};
