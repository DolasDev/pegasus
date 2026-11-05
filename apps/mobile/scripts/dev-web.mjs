#!/usr/bin/env node
// =============================================================================
// dev-web.mjs — `npm run dev:web`: run the app in a BROWSER against the
//               deployed API (the one apps/mobile/.env points at).
//
// Plain `npm run dev` works for devices but not for a browser: the deployed
// API's CORS allowlist rejects the Metro origin. This launcher keeps the browser
// same-origin instead of touching CORS:
//
//   browser ──► http://<host>:8081/api/*  (Metro) ──► EXPO_PUBLIC_API_URL from .env
//
//   PEGASUS_API_PROXY_TARGET = the real API from .env  → metro/api-proxy.js forwards to it
//   EXPO_PUBLIC_API_URL      = http://<host>:<port>     → the app calls Metro's own origin
//
// <host> is REACT_NATIVE_PACKAGER_HOSTNAME (default: the same tailnet address
// `npm run dev` uses), so a browser on another tailnet device works. A device
// on Expo Go also works — it reaches the API through the same forwarder.
//
// Extra args go to `expo start`, e.g. `npm run dev:web -- --port 8082`.
// Refresh a stale .env first with `npm run env:prod`.
// =============================================================================
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_HOST = '100.69.252.113' // keep in step with the `dev` script in package.json

function readDotEnv(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]),
    )
  } catch {
    return {}
  }
}

const args = process.argv.slice(2)
const portIdx = args.findIndex((a) => a === '--port' || a === '-p')
const port = portIdx >= 0 ? args[portIdx + 1] : '8081'
const host = process.env.REACT_NATIVE_PACKAGER_HOSTNAME || DEFAULT_HOST

const target =
  process.env.PEGASUS_API_PROXY_TARGET ||
  readDotEnv(path.join(mobileRoot, '.env')).EXPO_PUBLIC_API_URL
if (!target) {
  console.error(
    'dev:web: no EXPO_PUBLIC_API_URL in apps/mobile/.env — run `npm run env:prod` first.',
  )
  process.exit(1)
}

const appUrl = `http://${host}:${port}`
console.log(`dev:web: open ${appUrl}  (API calls → ${appUrl}/api/* → ${target}/api/*)`)
console.log('dev:web: this is the LIVE API — real data. SSO sign-in cannot complete in a browser.')

const child = spawn('npx', ['expo', 'start', '--clear', ...args], {
  cwd: mobileRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    REACT_NATIVE_PACKAGER_HOSTNAME: host,
    PEGASUS_API_PROXY_TARGET: target,
    EXPO_PUBLIC_API_URL: appUrl,
  },
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
