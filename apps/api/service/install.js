#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Windows Service installer for Pegasus API
//
// Registers the Node.js server (server.ts compiled to server.js) as a
// Windows Service using node-windows. The service auto-starts on boot and
// restarts on crash.
//
// Usage:
//   npm run service:install
//   (or: node service/install.js)
// ---------------------------------------------------------------------------

const path = require('path')
const { Service } = require('node-windows')

const svc = new Service({
  name: 'Pegasus API',
  description: 'Pegasus move management API server',
  script: path.join(__dirname, '..', 'dist', 'server.js'),
  nodeOptions: [],
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: process.env.PORT || '3000' },
    { name: 'HOST', value: process.env.HOST || '0.0.0.0' },
  ],
})

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
