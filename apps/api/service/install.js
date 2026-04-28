#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Windows Service installer for Pegasus API
//
// Registers the Node.js server (server.ts compiled to server.js) as a
// Windows Service using node-windows. The service auto-starts on boot and
// restarts on crash.
//
// Reads apps/api/.env at install time and bakes the required runtime env
// vars (DATABASE_URL, SKIP_AUTH, COGNITO_*) into the service XML, so the
// service runs correctly under LocalSystem (which does not inherit per-user
// env vars).
//
// Usage:
//   npm run service:install
//   (or: node service/install.js)
// ---------------------------------------------------------------------------

const path = require('path')
const fs = require('fs')

const apiRoot = path.join(__dirname, '..')
const envPath = path.join(apiRoot, '.env')
const repoRoot = path.join(apiRoot, '..', '..')
const logPath = process.env.PEGASUS_LOG_DIR || path.join(repoRoot, 'logs')

require('dotenv').config({ path: envPath })

fs.mkdirSync(logPath, { recursive: true })

const { Service } = require('node-windows')

const FORWARDED_VARS = [
  'DATABASE_URL',
  'SKIP_AUTH',
  'COGNITO_JWKS_URL',
  'COGNITO_TENANT_CLIENT_ID',
  'COGNITO_USER_POOL_ID',
]

if (!process.env.DATABASE_URL) {
  console.error(
    `[install] DATABASE_URL not set. Create ${envPath} with at minimum:\n` +
      `  DATABASE_URL=postgres://user:pass@host:5432/db\n` +
      `  SKIP_AUTH=true\n`,
  )
  process.exit(1)
}

const env = [
  { name: 'NODE_ENV', value: 'production' },
  { name: 'PORT', value: process.env.PORT || '3000' },
  { name: 'HOST', value: process.env.HOST || '0.0.0.0' },
]

for (const name of FORWARDED_VARS) {
  const value = process.env[name]
  if (value !== undefined && value !== '') {
    env.push({ name, value })
  }
}

if (!fs.existsSync(envPath)) {
  console.warn(`[install] Note: ${envPath} not found — using process env only.`)
}

const svc = new Service({
  name: 'Pegasus API',
  description: 'Pegasus move management API server',
  script: path.join(apiRoot, 'dist', 'server.js'),
  nodeOptions: [],
  env,
  logpath: logPath,
  logmode: 'rotate',
})

console.log(`[install] Logs will be written to: ${logPath}`)

svc.on('install', () => {
  console.log('Service installed. Starting...')
  svc.start()
})

svc.on('alreadyinstalled', () => {
  console.log('Service is already installed.')
})

svc.on('start', () => {
  console.log('Service started.')
})

svc.on('error', (err) => {
  console.error('Service error:', err)
})

svc.install()
