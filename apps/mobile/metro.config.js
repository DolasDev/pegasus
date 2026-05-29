// Use expo's metro-config sub-export rather than requiring @expo/metro-config
// directly — that's the supported API and lets npm resolve via the `expo`
// package (always hoisted) instead of needing @expo/metro-config to win
// hoisting on its own. expo-doctor flags the direct dep as wrong.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo (merge with Expo defaults)
config.watchFolders = [...(config.watchFolders || []), monorepoRoot];

// Resolve modules from both the app and the monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
