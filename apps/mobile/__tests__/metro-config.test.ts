/**
 * metro.config.js — the web-only resolver alias and the opt-in /api forwarder.
 *
 * Both exist so the app can run in a browser (Expo web) during development:
 *   - react-native-document-scanner-plugin throws on import under react-native-web,
 *     so web bundles must get the stub while device bundles keep the real module.
 *   - the deployed API's CORS allowlist rejects the Expo dev origin, so `dev:web`
 *     forwards /api/* through Metro and the browser only ever talks same-origin.
 *
 * @jest-environment node
 */
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'

const MOBILE_ROOT = path.resolve(__dirname, '..')
const STUB = path.join(MOBILE_ROOT, 'metro', 'document-scanner.web.js')

type Resolution = { type: string; filePath?: string }
type ResolveRequest = (ctx: unknown, moduleName: string, platform: string | null) => Resolution

function loadConfig(env: Record<string, string | undefined> = {}) {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]
  try {
    let config: {
      resolver: { resolveRequest: ResolveRequest }
      server: { enhanceMiddleware?: (mw: unknown, server: unknown) => unknown }
    } = undefined as never
    jest.isolateModules(() => {
      // A real require() inside isolateModules: the config reads process.env at load time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      config = require('../metro.config.js')
    })
    return config
  } finally {
    process.env = saved
  }
}

const passthrough = { resolveRequest: jest.fn(() => ({ type: 'sourceFile', filePath: 'REAL' })) }

describe('resolver: react-native-document-scanner-plugin', () => {
  beforeEach(() => passthrough.resolveRequest.mockClear())

  it('resolves to the web stub for a web bundle, with no env flag needed', () => {
    const { resolver } = loadConfig({ PEGASUS_STORE_CAPTURE: undefined })
    expect(
      resolver.resolveRequest(passthrough, 'react-native-document-scanner-plugin', 'web'),
    ).toEqual({
      type: 'sourceFile',
      filePath: STUB,
    })
    expect(passthrough.resolveRequest).not.toHaveBeenCalled()
  })

  it.each(['ios', 'android'])('resolves the real native module for %s', (platform) => {
    const { resolver } = loadConfig()
    expect(
      resolver.resolveRequest(passthrough, 'react-native-document-scanner-plugin', platform),
    ).toEqual({
      type: 'sourceFile',
      filePath: 'REAL',
    })
  })

  it('stub mirrors the API documentCapture.ts uses and reports a cancelled scan', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stub = require(STUB)
    expect(stub.ResponseType.ImageFilePath).toBe('imageFilePath')
    expect(stub.ScanDocumentResponseStatus.Cancel).toBe('cancel')
    await expect(stub.default.scanDocument({})).resolves.toEqual({
      status: 'cancel',
      scannedImages: [],
    })
  })
})

describe('server: /api forwarder', () => {
  it('is not installed unless PEGASUS_API_PROXY_TARGET is set', () => {
    const { server } = loadConfig({ PEGASUS_API_PROXY_TARGET: undefined })
    const metroMiddleware = jest.fn()
    const enhanced = server.enhanceMiddleware
      ? server.enhanceMiddleware(metroMiddleware, {})
      : metroMiddleware
    expect(enhanced).toBe(metroMiddleware)
  })

  describe('when PEGASUS_API_PROXY_TARGET is set', () => {
    let upstream: http.Server
    let front: http.Server
    let frontUrl: string
    let upstreamHost: string
    let seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[]
    const metroHits: string[] = []

    beforeAll(async () => {
      seen = []
      upstream = http.createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          seen.push({ method: req.method, url: req.url, headers: req.headers, body })
          res.writeHead(418, { 'content-type': 'application/json', 'x-upstream': 'yes' })
          res.end(JSON.stringify({ echoed: body }))
        })
      })
      await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
      upstreamHost = `127.0.0.1:${(upstream.address() as AddressInfo).port}`
      const target = `http://${upstreamHost}`

      const { server } = loadConfig({ PEGASUS_API_PROXY_TARGET: target })
      const metro = (req: http.IncomingMessage, res: http.ServerResponse) => {
        metroHits.push(req.url ?? '')
        res.writeHead(200)
        res.end('metro')
      }
      const handler = server.enhanceMiddleware!(metro, {}) as (
        req: http.IncomingMessage,
        res: http.ServerResponse,
        next: () => void,
      ) => void
      front = http.createServer((req, res) => handler(req, res, () => metro(req, res)))
      await new Promise<void>((r) => front.listen(0, '127.0.0.1', r))
      frontUrl = `http://127.0.0.1:${(front.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      await new Promise((r) => front.close(r))
      await new Promise((r) => upstream.close(r))
    })

    it('forwards /api/* with method, path, query and body; returns status, headers and body', async () => {
      const res = await fetch(`${frontUrl}/api/auth/resolve-tenants?x=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://100.64.0.1:8081' },
        body: JSON.stringify({ email: 'a@b.c' }),
      })
      expect(res.status).toBe(418)
      expect(res.headers.get('x-upstream')).toBe('yes')
      expect(await res.json()).toEqual({ echoed: '{"email":"a@b.c"}' })

      const hit = seen.at(-1)!
      expect(hit.method).toBe('POST')
      expect(hit.url).toBe('/api/auth/resolve-tenants?x=1')
      expect(hit.headers.host).toBe(upstreamHost)
      expect(hit.headers.origin).toBeUndefined()
    })

    it('leaves non-/api requests to Metro', async () => {
      const res = await fetch(`${frontUrl}/index.bundle?platform=web`)
      expect(await res.text()).toBe('metro')
      expect(metroHits).toContain('/index.bundle?platform=web')
    })

    it('does not treat /apiary as /api', async () => {
      await fetch(`${frontUrl}/apiary`)
      expect(metroHits).toContain('/apiary')
    })
  })
})
