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

// Watching the whole monorepo root pulls in volatile paths that other tools
// create/delete underneath the watcher — most notably concurrent agent
// worktrees under .claude/worktrees and CDK's transient cdk.out/bundling-temp-*
// dirs. When one of those vanishes mid-walk, metro-file-map throws an uncaught
// ENOENT and kills the dev server. Exclude them from the watch.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  /[/\\]\.claude[/\\]worktrees[/\\].*/,
  /[/\\]cdk\.out[/\\].*/,
];

// Resolve modules from both the app and the monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
