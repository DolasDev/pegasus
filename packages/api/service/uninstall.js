#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Windows Service uninstaller for Pegasus API
//
// Removes the Windows Service registered by install.js.
//
// Usage:
//   npm run service:uninstall
//   (or: node service/uninstall.js)
// ---------------------------------------------------------------------------

const path = require('path')
const { Service } = require('node-windows')

const svc = new Service({
  name: 'Pegasus API',
  script: path.join(__dirname, '..', 'dist', 'server.js'),
})

svc.on('uninstall', () => {
  console.log('Service uninstalled.')
})

svc.on('alreadyuninstalled', () => {
  console.log('Service is already uninstalled.')
})

svc.on('error', (err) => {
  console.error('Service error:', err)
})

svc.uninstall()
