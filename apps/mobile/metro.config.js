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

// @pegasus/domain → its TypeScript source.
//
// theme and api-http point `main` at src/, but domain's `main` is ./dist (its
// tsc build output, gitignored — the API bundles from it). Nothing builds dist
// on an EAS machine, so resolving the package normally would fail there. Domain
// is pure TypeScript with no runtime dependencies, so Metro compiles the source
// directly — the same thing jest.config.js's moduleNameMapper does for tests.
const domainEntry = path.resolve(monorepoRoot, 'packages/domain/src/index.ts');

// react-native-document-scanner-plugin → an import-safe stub on WEB only.
//
// Its entry point runs TurboModuleRegistry.getEnforcing('DocumentScanner') at
// module scope and it ships no web implementation, so under react-native-web
// the import throws and takes down the shipment route (the one that owns the
// Documents tab) with "Cannot read properties of undefined (reading
// 'getEnforcing')". Every web bundle needs the stub — `expo start --web` and the
// store-screenshot export (npm run store:export) alike. ios/android resolve the
// real native module, unchanged. See metro/document-scanner.web.js.
const scannerStub = path.resolve(projectRoot, 'metro/document-scanner.web.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@pegasus/domain') {
    return { type: 'sourceFile', filePath: domainEntry };
  }
  if (platform === 'web' && moduleName === 'react-native-document-scanner-plugin') {
    return { type: 'sourceFile', filePath: scannerStub };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Dev-only /api forwarder (npm run dev:web). Set by scripts/dev-web.mjs to the
// real API origin; the app is then pointed at Metro's own origin so the browser
// never makes a cross-origin call. Unset (every other flow) → nothing installed.
// See metro/api-proxy.js.
const apiProxyTarget = process.env.PEGASUS_API_PROXY_TARGET;
if (apiProxyTarget) {
  const { createApiProxyMiddleware } = require('./metro/api-proxy');
  const apiProxy = createApiProxyMiddleware(apiProxyTarget);
  const previous = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (metroMiddleware, server) => {
    const inner = previous ? previous(metroMiddleware, server) : metroMiddleware;
    return (req, res, next) => apiProxy(req, res, () => inner(req, res, next));
  };
}

module.exports = config;
