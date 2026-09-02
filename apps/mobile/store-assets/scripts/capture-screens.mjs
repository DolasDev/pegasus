#!/usr/bin/env node
// =============================================================================
// capture-screens.mjs — capture raw store screenshots of the REAL app.
//
//   npm run store:export      # once, or after any app code change
//   npm run store:capture
//
// How this works, and why:
//
// The screenshots are of the actual app — `expo export --platform web` builds
// the real `app/` routes through react-native-web, and Playwright drives that
// build. Nothing here re-implements a screen, so a UI change shows up in the
// next capture instead of silently drifting from a hand-drawn mockup.
//
// The API is served from store-assets/fixtures/screens.json, not from a live
// backend. That is deliberate:
//   - no real customer name or address can leak into a public listing,
//   - captures are deterministic and reproducible months later,
//   - no prod credentials, VPN tunnel or CORS proxy is needed to re-run this.
// The auth wall is passed the same way the app itself passes it on web: by
// seeding `localStorage['pegasus_session']`, which is exactly what
// src/utils/storage.ts writes after a real login.
//
// Output: store-assets/<platform>/screenshots/raw/*.png at exact store pixel
// dimensions. `compose-marketing.mjs` turns those into the framed, captioned
// images that get uploaded.
// =============================================================================

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Import from @playwright/test, NOT bare 'playwright': @playwright/mcp hoists a
// prerelease `playwright` to the repo root that shadows the stable one and asks
// for a Chromium build nobody installs. @playwright/test is the version the e2e
// suite already pins and installs browsers for.
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOBILE = resolve(HERE, '../..')
const STORE = join(MOBILE, 'store-assets')
const DIST = join(MOBILE, 'dist-web')

const fixtures = JSON.parse(await readFile(join(STORE, 'fixtures/screens.json'), 'utf8'))

// --- device targets --------------------------------------------------------
//
// Both stores specify PIXEL dimensions; Playwright takes CSS pixels, so each
// target is (css width x css height) x deviceScaleFactor = the required pixels.
//
//   iOS  1320x2868  — the 6.9" iPhone set App Store Connect requires.
//   Play 1080x2400  — a 20:9 phone, inside Play's 16:9..9:16 ratio window and
//                     above its 1080px minimum on the long edge.
const TARGETS = [
  { id: 'ios', label: 'iOS 6.9"', css: { width: 440, height: 956 }, scale: 3, out: 'ios' },
  { id: 'android', label: 'Play phone', css: { width: 360, height: 800 }, scale: 3, out: 'android' },
]

// --- render fidelity fixups ------------------------------------------------

/**
 * Restore the natural height of a horizontal chip/tab row.
 *
 * react-native-web gives the trips screen's horizontal ScrollView an explicit
 * pixel height it computed before the chip text was measured (34.53px), and
 * `align-items: stretch` then pushes that stale height down the tree: the
 * content container's content box collapses to 18.53px, every pill is stretched
 * to it, and 19px of text hangs 9.5px below its own pill. Measured on all five
 * chips identically.
 *
 * This is an RNW layout defect, not something a driver sees — the same screen
 * ships on iOS/Android (version code 15) with correctly sized chips, because
 * native measures text before laying out. Clearing the stale heights makes the
 * screenshot MORE faithful to the shipped app, not less.
 *
 * Deliberately narrow: it walks up from one known label to the nearest
 * horizontal scroller and clears heights only along that path, rather than
 * carpet-bombing the page with `height: auto !important`. The caller asserts
 * the result, so if a future RNW release changes this, the capture fails loudly
 * instead of quietly shipping a squashed PNG.
 */
function relaxCollapsedChipRow(anchorText) {
  return async (page) => {
    const touched = await page.evaluate((text) => {
      const leaf = [...document.querySelectorAll('div')].find(
        (el) => el.children.length === 0 && el.textContent.trim() === text,
      )
      if (!leaf) return -1

      let node = leaf.parentElement
      let n = 0
      for (let i = 0; i < 5 && node; i++) {
        const isScroller = getComputedStyle(node).overflowX !== 'visible'
        node.style.height = 'auto'
        node.style.minHeight = '0px'
        node.style.alignItems = 'center'
        n++
        if (isScroller) break
        node = node.parentElement
      }
      return n
    }, anchorText)

    if (touched < 0) throw new Error(`chip-row fixup: no element with text "${anchorText}"`)

    // Assert the pill now actually contains its own text.
    const bad = await page.evaluate((text) => {
      const leaf = [...document.querySelectorAll('div')].find(
        (el) => el.children.length === 0 && el.textContent.trim() === text,
      )
      const t = leaf.getBoundingClientRect()
      const p = leaf.parentElement.getBoundingClientRect()
      return t.bottom > p.bottom + 0.5 || t.top < p.top - 0.5
        ? `text ${t.top.toFixed(1)}-${t.bottom.toFixed(1)} vs pill ${p.top.toFixed(1)}-${p.bottom.toFixed(1)}`
        : null
    }, anchorText)

    if (bad) throw new Error(`chip-row fixup did not take: ${bad}`)
  }
}

// --- screens ---------------------------------------------------------------
//
// The authenticated screens are reached by NAVIGATING THE APP, not by loading
// their URLs. Deep links do not survive a cold load: `app/_layout.tsx` wraps
// them in `<Stack.Protected guard={isAuthenticated}>`, and `isAuthenticated`
// is false for the first frames while the session is restored from storage, so
// the router bounces any deep link to `(auth)` and settles on the drawer index
// once auth resolves. Every deep-linked capture came back as the dashboard.
//
// Tapping through is also the more honest capture: it exercises the real
// navigation stack, so headers, titles and back affordances are the ones a
// driver actually sees.
//
// `waitFor` is the text that proves the screen rendered its DATA — capturing on
// a spinner is the classic way to ship a broken listing. Prefer `exact: true`:
// a loose 'SHIPMENTS' silently matched the dashboard's "Active Shipments" and
// passed a screenshot of the wrong screen.
const SCREENS = [
  {
    name: '01-login',
    authed: false,
    waitFor: { text: 'Driver Portal', exact: true },
    caption: 'Sign in once. Your trips are waiting.',
  },
  {
    name: '02-dashboard',
    authed: true,
    waitFor: { text: 'TODAY AT A GLANCE', exact: true },
    caption: 'Your day, at a glance.',
  },
  {
    name: '03-trips',
    authed: true,
    // The dashboard's "Offered Trips" tile pushes /trips.
    tapLabel: /Open My Trips/,
    waitFor: { text: 'Trip 88412 · Chicago → Denver', exact: true },
    fixup: relaxCollapsedChipRow('All'),
    caption: 'Every trip, with status you can trust.',
  },
  {
    name: '04-trip-detail',
    authed: true,
    tapText: { text: 'Trip 88412 · Chicago → Denver', exact: true },
    waitFor: { text: 'SHIPMENTS (3)', exact: true },
    caption: 'Drill into a trip and its shipments.',
  },
  {
    name: '05-shipment',
    authed: true,
    tapText: { text: '#M2609114', exact: true },
    waitFor: { text: 'Special instructions', exact: true },
    caption: 'Addresses, spreads and instructions in one place.',
  },
  {
    name: '06-documents',
    authed: true,
    tapText: { text: 'Documents', exact: true },
    waitFor: { text: 'BOL-M2609114.pdf', exact: false },
    caption: 'Scan paperwork straight from the cab.',
  },
]

// --- static server for the exported web build ------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

function startServer(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let filePath = join(root, decodeURIComponent(url.pathname))

    // expo-router exports a SPA: unknown paths fall back to index.html so
    // client-side routing owns /trips, /trip/:id, /shipment/:orderNum.
    if (!existsSync(filePath) || !extname(filePath)) {
      filePath = join(root, 'index.html')
    }
    try {
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

// --- fixture routing -------------------------------------------------------

/**
 * Resolve a request to a fixture. Keys are "<METHOD> <pathname>" — the query
 * string is ignored because the app passes filters/search terms there and the
 * screenshot only cares about the shape that comes back.
 */
function matchFixture(method, pathname) {
  const exact = fixtures.routes[`${method} ${pathname}`]
  if (exact) return exact
  return null
}

async function installFixtures(context) {
  const unmatched = new Set()

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const isApi = url.pathname.startsWith('/api/')

    if (!isApi) return route.continue()

    const fixture = matchFixture(req.method(), url.pathname)
    if (fixture) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      })
    }

    // An unmatched API call means a screen wants data the fixtures don't have.
    // Fail it loudly rather than hanging the capture on a pending request.
    unmatched.add(`${req.method()} ${url.pathname}`)
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'no fixture' }),
    })
  })

  return unmatched
}

// --- capture ---------------------------------------------------------------

async function capture() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error(
      `\n✘ No web export at ${DIST}\n\n  Build it first:\n    cd apps/mobile && npm run store:export\n`,
    )
    process.exit(1)
  }

  const server = await startServer(DIST)
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  const browser = await chromium.launch()

  const problems = []

  for (const target of TARGETS) {
    const outDir = join(STORE, target.out, 'screenshots/raw')
    await rm(outDir, { recursive: true, force: true })
    await mkdir(outDir, { recursive: true })

    console.log(`\n${target.label}  ${target.css.width * target.scale}x${target.css.height * target.scale}`)

    const context = await browser.newContext({
      viewport: target.css,
      deviceScaleFactor: target.scale,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'light',
      // A fixed locale + timezone keeps rendered dates and the currency in the
      // dashboard byte-identical between runs and between machines.
      locale: 'en-US',
      timezoneId: 'America/Chicago',
    })

    const unmatched = await installFixtures(context)

    // One page per auth state. The authenticated screens share a single page so
    // each tap continues the previous screen's navigation stack.
    let page = null
    let pageAuthed = null

    for (const screen of SCREENS) {
      if (page === null || pageAuthed !== screen.authed) {
        if (page) await page.close()
        page = await context.newPage()
        pageAuthed = screen.authed

        // Seed (or clear) the session before any app code runs, so the router's
        // first render already knows whether it is authenticated. Doing it after
        // load would capture a login-screen flash.
        await page.addInitScript(
          ({ authed, session }) => {
            if (authed) localStorage.setItem('pegasus_session', JSON.stringify(session))
            else localStorage.removeItem('pegasus_session')

            // Kill animations and transitions. Navigation and press feedback
            // animate; a screenshot taken mid-transition catches a half-faded
            // screen, and the result is not reproducible run to run.
            document.addEventListener('DOMContentLoaded', () => {
              const style = document.createElement('style')
              style.textContent =
                '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
              document.head.appendChild(style)
            })
          },
          { authed: screen.authed, session: fixtures.session },
        )

        await page.goto(origin, { waitUntil: 'networkidle' })
      }

      try {
        if (screen.tapLabel) {
          await page.getByLabel(screen.tapLabel).first().click({ timeout: 15000 })
        } else if (screen.tapText) {
          await page
            .getByText(screen.tapText.text, { exact: screen.tapText.exact })
            .first()
            .click({ timeout: 15000 })
        }

        await page
          .getByText(screen.waitFor.text, { exact: screen.waitFor.exact })
          .first()
          .waitFor({ timeout: 15000 })
      } catch (err) {
        problems.push(
          `${target.id}/${screen.name}: ${err.name === 'TimeoutError' ? `never reached "${screen.waitFor.text}"` : err.message}`,
        )
        await page.screenshot({ path: join(outDir, `FAILED-${screen.name}.png`) })
        // The stack is now in an unknown state — restart the flow for the next
        // screen rather than compounding the failure.
        await page.close()
        page = null
        continue
      }

      if (screen.fixup) {
        try {
          await screen.fixup(page)
        } catch (err) {
          problems.push(`${target.id}/${screen.name}: ${err.message}`)
          await page.screenshot({ path: join(outDir, `FAILED-${screen.name}.png`) })
          await page.close()
          page = null
          continue
        }
      }

      // Settle before capturing. Without this the trips screen came back with
      // its filter chips overlapping and list content bleeding through the
      // header — react-native-web was still mid-layout. Scroll every scroller
      // back to its origin (a horizontal chip ScrollView had drifted) and give
      // the virtualized list a beat to finish.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollTop || el.scrollLeft) {
            el.scrollTop = 0
            el.scrollLeft = 0
          }
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(1200)

      await page.screenshot({ path: join(outDir, `${screen.name}.png`) })
      console.log(`  ✔ ${screen.name}`)
    }

    if (page) await page.close()

    if (unmatched.size) {
      problems.push(`${target.id}: unmatched API routes → ${[...unmatched].join(', ')}`)
    }

    await context.close()
  }

  await browser.close()
  server.close()

  if (problems.length) {
    console.error('\n✘ Capture problems:')
    for (const p of problems) console.error(`   - ${p}`)
    process.exit(1)
  }

  console.log('\nDone. Raw screenshots written. Next: npm run store:compose\n')
}

await capture()
