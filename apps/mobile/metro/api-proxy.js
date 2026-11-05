// Dev-only /api forwarder for Expo web (`npm run dev:web`).
//
// Why: the deployed API's CORS allowlist only admits its own web origins, so a
// browser running the app from the Metro origin (http://<host>:8081) is blocked
// at the preflight. Phones don't enforce CORS, which is why the same build works
// on a device. Changing prod CORS for a dev loop is the wrong fix; instead
// `dev:web` points EXPO_PUBLIC_API_URL at Metro itself and this middleware
// forwards /api/* to the real API, so the browser only ever makes same-origin
// requests and CORS never applies.
//
// It runs inside the Metro dev server (installed via server.enhanceMiddleware in
// metro.config.js), so there is no extra process or port — and it can never be
// part of a device, store, or exported web build, which don't run Metro's server.

const http = require('http')
const https = require('https')

/** Request headers that describe the browser's hop, not the upstream's (host is rewritten). */
const DROP_REQUEST_HEADERS = ['origin', 'referer', 'connection']

/**
 * @param {string} target Upstream origin, e.g. https://api.example.com
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => void}
 */
function createApiProxyMiddleware(target) {
  const upstream = new URL(target)
  const transport = upstream.protocol === 'https:' ? https : http

  return function apiProxy(req, res, next) {
    const url = req.url || ''
    if (url !== '/api' && !url.startsWith('/api/') && !url.startsWith('/api?')) return next()

    const headers = { ...req.headers, host: upstream.host }
    for (const h of DROP_REQUEST_HEADERS) delete headers[h]

    const proxied = transport.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: req.method,
        path: url,
        headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers)
        upRes.pipe(res)
      },
    )
    proxied.on('error', (err) => {
      if (res.headersSent) return res.destroy(err)
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'dev api proxy: upstream unreachable',
          target,
          detail: String(err),
        }),
      )
    })
    req.pipe(proxied)
  }
}

module.exports = { createApiProxyMiddleware }
