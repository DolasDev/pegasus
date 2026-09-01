#!/usr/bin/env node
// =============================================================================
// compose-marketing.mjs — turn raw captures into upload-ready listing images.
//
//   npm run store:compose
//
// Produces, per platform:
//   screenshots/framed/*.png   the raw capture on a branded panel with a
//                              one-line caption, at exact store pixel sizes
//   feature-graphic.png        1024x500, Google Play only (required)
//
// The RAW captures stay on disk untouched. Both stores accept either raw or
// framed screenshots, and which reads better is a judgement call — so this
// ships both and the uploader picks. Raw is the safer default for the first
// submission: it is unambiguously "the app", which is what a reviewer checks.
//
// Text is laid out by Chromium rather than composited with sharp so captions
// get real typography (kerning, hinting, ligatures) instead of pasted glyphs.
// =============================================================================

import { readFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOBILE = resolve(HERE, '../..')
const STORE = join(MOBILE, 'store-assets')
const ASSETS = join(MOBILE, 'assets')

const brand = JSON.parse(await readFile(join(STORE, 'brand.json'), 'utf8'))

// Captions live with the capture definitions so a screen and its marketing line
// cannot drift apart. Keep this list in sync with SCREENS there.
const CAPTIONS = {
  '01-login': 'Sign in once.\nYour trips are waiting.',
  '02-dashboard': 'Your day,\nat a glance.',
  '03-trips': 'Every trip, with\nstatus you can trust.',
  '04-trip-detail': 'Drill into a trip\nand its shipments.',
  '05-shipment': 'Addresses, spreads\nand instructions.',
  '06-documents': 'Scan paperwork\nstraight from the cab.',
}

const TARGETS = [
  { id: 'ios', dir: 'ios', css: { width: 440, height: 956 }, scale: 3 },
  { id: 'android', dir: 'android', css: { width: 360, height: 800 }, scale: 3 },
]

async function dataUri(path) {
  const buf = await readFile(path)
  return `data:image/png;base64,${buf.toString('base64')}`
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

function framedHtml({ shot, caption, css }) {
  const { brand: bg, brandDeep, brandSoft, onBrand, accent } = brand.colors
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${css.width}px;height:${css.height}px;overflow:hidden}
  body{
    font-family:${FONT_STACK};
    background:linear-gradient(160deg, ${brandSoft} 0%, ${bg} 45%, ${brandDeep} 100%);
    display:flex;flex-direction:column;align-items:center;
  }
  .caption{
    padding:${css.height * 0.055}px ${css.width * 0.09}px ${css.height * 0.03}px;
    text-align:center;
  }
  .caption h1{
    color:${onBrand};
    font-size:${css.width * 0.075}px;
    line-height:1.22;
    font-weight:700;
    letter-spacing:-0.02em;
    white-space:pre-line;
  }
  .rule{
    width:${css.width * 0.14}px;height:${Math.max(2, css.width * 0.008)}px;
    background:${accent};border-radius:99px;
    margin:${css.height * 0.022}px auto 0;
  }
  /* The device sits slightly oversized and bleeds off the bottom edge: it reads
     as a phone continuing past the frame rather than a floating rectangle. */
  .device{
    width:${css.width * 0.78}px;
    border-radius:${css.width * 0.062}px;
    overflow:hidden;
    border:${Math.max(2, css.width * 0.007)}px solid rgba(248,250,252,0.16);
    box-shadow:0 ${css.height * 0.02}px ${css.height * 0.05}px rgba(0,0,0,0.45);
    flex:1;
  }
  .device img{width:100%;display:block}
</style></head>
<body>
  <div class="caption"><h1>${caption}</h1><div class="rule"></div></div>
  <div class="device"><img src="${shot}"></div>
</body></html>`
}

function featureHtml({ logo, css }) {
  const { brand: bg, brandDeep, brandSoft, onBrand, accent, muted } = brand.colors
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${css.width}px;height:${css.height}px;overflow:hidden}
  body{
    font-family:${FONT_STACK};
    background:linear-gradient(115deg, ${brandSoft} 0%, ${bg} 50%, ${brandDeep} 100%);
    display:flex;align-items:center;gap:${css.width * 0.045}px;
    padding:0 ${css.width * 0.07}px;
    position:relative;overflow:hidden;
  }
  /* A soft accent bloom keeps a flat navy panel from reading as dead space. */
  body::after{
    content:'';position:absolute;right:-12%;top:-40%;
    width:55%;aspect-ratio:1;border-radius:50%;
    background:radial-gradient(circle, ${accent}2E 0%, transparent 68%);
  }
  .mark{
    width:${css.height * 0.42}px;height:${css.height * 0.42}px;
    flex:none;object-fit:contain;
  }
  .copy{position:relative;z-index:1}
  .name{
    color:${onBrand};font-size:${css.height * 0.125}px;
    font-weight:700;letter-spacing:-0.025em;line-height:1.05;
  }
  .sub{
    color:${accent};font-size:${css.height * 0.056}px;
    font-weight:600;letter-spacing:0.14em;text-transform:uppercase;
    margin-top:${css.height * 0.028}px;
  }
  .tag{
    color:${muted};font-size:${css.height * 0.052}px;
    margin-top:${css.height * 0.045}px;line-height:1.35;max-width:${css.width * 0.6}px;
  }
</style></head>
<body>
  ${logo ? `<img class="mark" src="${logo}">` : ''}
  <div class="copy">
    <div class="name">${brand.appName}</div>
    <div class="sub">${brand.subtitle}</div>
    <div class="tag">${brand.tagline}</div>
  </div>
</body></html>`
}

// --- run -------------------------------------------------------------------

const browser = await chromium.launch()
let missingLogo = false

for (const target of TARGETS) {
  const rawDir = join(STORE, target.dir, 'screenshots/raw')
  const outDir = join(STORE, target.dir, 'screenshots/framed')

  if (!existsSync(rawDir)) {
    console.error(`\n✘ No raw captures at ${rawDir}\n  Run: npm run store:capture\n`)
    process.exit(1)
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const page = await browser.newPage({
    viewport: target.css,
    deviceScaleFactor: target.scale,
  })

  console.log(`\n${target.id}  ${target.css.width * target.scale}x${target.css.height * target.scale}`)

  for (const [name, caption] of Object.entries(CAPTIONS)) {
    const src = join(rawDir, `${name}.png`)
    if (!existsSync(src)) {
      console.log(`  – ${name} (no raw capture, skipped)`)
      continue
    }
    await page.setContent(framedHtml({ shot: await dataUri(src), caption, css: target.css }))
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: join(outDir, `${name}.png`) })
    console.log(`  ✔ ${name}`)
  }

  await page.close()
}

// --- Play feature graphic (1024x500, required for a Play listing) -----------

const logoPath = join(ASSETS, 'logo-mark.png')
let logo = null
if (existsSync(logoPath)) {
  logo = await dataUri(logoPath)
} else {
  missingLogo = true
}

const featureCss = { width: 512, height: 250 }
const featurePage = await browser.newPage({ viewport: featureCss, deviceScaleFactor: 2 })
await featurePage.setContent(featureHtml({ logo, css: featureCss }))
await featurePage.waitForLoadState('networkidle')
await featurePage.screenshot({ path: join(STORE, 'android/feature-graphic.png') })
await featurePage.close()
console.log(`\n  ✔ android/feature-graphic.png  1024x500${logo ? '' : '  (TEXT ONLY — no logo yet)'}`)

await browser.close()

if (missingLogo) {
  console.log(
    [
      '',
      '⚠ assets/logo-mark.png does not exist, so the feature graphic has no mark on it.',
      '  Drop the logo and run:  npm run store:icons && npm run store:compose',
      '',
    ].join('\n'),
  )
} else {
  console.log('\nDone.\n')
}
