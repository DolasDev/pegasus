module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|expo|@expo|expo-status-bar|expo-router|expo-constants|expo-image-picker|expo-linking|expo-secure-store|react-native-web|react-native-safe-area-context|react-native-screens)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/*.test.{ts,tsx}',
    '!**/__tests__/**',
  ],
  // Ensure Jest resolves packages from mobile's own node_modules first.
  // This is required because @testing-library/react-native is hoisted to the
  // root workspace node_modules and its internal require calls for
  // react-test-renderer and react must resolve to the local versions.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    // Pin React to the local copy so react and react-test-renderer (hoisted to root)
    // always share the same module instance. Without this, the root react-test-renderer
    // resolves a different React copy, breaking hook calls.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^react-test-renderer$': '<rootDir>/node_modules/react-test-renderer',
    '^react-test-renderer/(.*)$': '<rootDir>/node_modules/react-test-renderer/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pegasus/theme$': '<rootDir>/../../packages/theme/src/index.ts',
  },
};
