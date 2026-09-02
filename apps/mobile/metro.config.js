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

// Store-screenshot capture only (npm run store:export).
//
// The screenshots are taken by driving a real `expo export --platform web`
// build in a browser, which means every route has to survive react-native-web.
// `react-native-document-scanner-plugin` does not: its entry point runs
// TurboModuleRegistry.getEnforcing('DocumentScanner') at module scope and there
// is no web implementation, so importing it throws and the shipment route —
// the one that owns the Documents tab — renders as a blank page.
//
// Alias it to an import-safe stub, gated on BOTH platform === 'web' and the
// PEGASUS_STORE_CAPTURE env var, so device/store builds and the normal `expo
// start --web` dev flow resolve the real native module exactly as before.
if (process.env.PEGASUS_STORE_CAPTURE === '1') {
  const scannerStub = path.resolve(
    projectRoot,
    'store-assets/scripts/document-scanner.web-stub.js',
  );

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform === 'web' && moduleName === 'react-native-document-scanner-plugin') {
      return { type: 'sourceFile', filePath: scannerStub };
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
