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
  // react must resolve to the local versions.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    // Pin React to the local copy so hoisted packages always share the same
    // module instance. Without this, hook calls can break.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pegasus/theme$': '<rootDir>/../../packages/theme/src/index.ts',
  },
};
