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
    // Force all test modules (including react-test-renderer) to share a single
    // React instance from the mobile workspace, avoiding dual-React hook errors
    // when the monorepo root has a different React version than Expo requires.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^react-test-renderer$': '<rootDir>/node_modules/react-test-renderer',
    '^react-test-renderer/(.*)$': '<rootDir>/node_modules/react-test-renderer/$1',
  },
};
