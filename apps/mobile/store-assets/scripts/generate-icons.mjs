#!/usr/bin/env node
// =============================================================================
// generate-icons.mjs — derive every launcher/store icon from one logo source.
//
//   node store-assets/scripts/generate-icons.mjs
//
// Source of truth: apps/mobile/assets/logo-source.{svg,png} — the SQUARE mark.
// Optional:        apps/mobile/assets/logo-wordmark-source.{svg,png} — the
//                  horizontal lockup (mark + wordmark), used by the login
//                  screen and the Play feature graphic.
//
// Re-run this whenever the logo changes. Every output below is generated —
// never hand-edit them.
//
// Why each output looks the way it does:
//   icon.png            iOS/launcher. Opaque brand background, no alpha: iOS
//                       renders alpha as BLACK and applies its own corner mask,
//                       so the source must be a full-bleed square.
//   adaptive-icon.png   Android adaptive FOREGROUND, transparent. Android crops
//                       the outer ~1/6 on every side and may mask to a circle,
//                       so the mark is inset to the guaranteed-visible zone
//                       (brand.adaptiveScale). Its background comes from
//                       app.json → android.adaptiveIcon.backgroundColor.
//   splash-icon.png     Transparent; app.json splash resizeMode is "contain"
//                       over splash.backgroundColor.
//   icon-512.png        Google Play store listing icon. Play composites its own
//                       shape mask and renders transparency as black — opaque.
// =============================================================================

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOBILE = resolve(HERE, '../..')
const ASSETS = join(MOBILE, 'assets')
const STORE = join(MOBILE, 'store-assets')

const brand = JSON.parse(await readFile(join(STORE, 'brand.json'), 'utf8'))

/** Locate an optional source in either vector or raster form. */
function findSource(stem) {
  for (const ext of ['svg', 'png']) {
    const p = join(ASSETS, `${stem}.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Rasterize a logo source at a target width.
 *
 * sharp rasterizes SVG at its intrinsic size and only then resizes, so a small
 * viewBox upscales into a blurry mess. `density` scales rasterization itself:
 * we solve for the DPI that yields at least the requested width.
 */
async function rasterize(sourcePath, targetWidth) {
  if (!sourcePath.endsWith('.svg')) {
    return sharp(sourcePath).ensureAlpha()
  }
  const svg = await readFile(sourcePath)
  const intrinsic = await sharp(svg).metadata()
  const baseWidth = intrinsic.width || 512
  const density = Math.min(2400, Math.ceil((targetWidth / baseWidth) * 72 * 1.2))
  return sharp(svg, { density }).ensureAlpha()
}

/** Trim transparent padding so `scale` means the same thing for every source. */
async function trimmed(sourcePath, targetWidth) {
  const img = await rasterize(sourcePath, targetWidth)
  try {
    return await img.trim({ threshold: 1 }).png().toBuffer()
  } catch {
    // A logo with no transparent margin trims to nothing — keep it as-is.
    return await img.png().toBuffer()
  }
}

/**
 * Place `logo` centered on a `size`x`size` canvas, occupying `scale` of it.
 * `background` null => transparent.
 */
async function centered({ logo, size, scale, background, stripAlpha = false }) {
  const box = Math.round(size * scale)
  const fitted = await sharp(logo)
    .resize(box, box, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer()

  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })

  let composed = canvas.composite([{ input: fitted, gravity: 'centre' }])
  if (background) composed = composed.flatten({ background })
  // Apple rejects a marketing icon that carries an alpha CHANNEL, even a fully
  // opaque one — flatten alone is not enough, the channel has to go.
  if (stripAlpha) composed = composed.removeAlpha()
  return composed.png().toBuffer()
}

async function emit(path, buffer) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buffer)
  const { width, height, channels } = await sharp(buffer).metadata()
  console.log(`  ✔ ${path.replace(`${MOBILE}/`, '')}  ${width}x${height}  ${channels}ch`)
}

// --- run -------------------------------------------------------------------

const markSource = findSource('logo-source')
if (!markSource) {
  console.error(
    [
      '',
      '✘ No logo source found.',
      '',
      `  Drop the SQUARE logo mark at one of:`,
      `    ${join(ASSETS, 'logo-source.svg')}   (preferred — vector)`,
      `    ${join(ASSETS, 'logo-source.png')}   (>=1024px, transparent background)`,
      '',
      `  Optionally also drop the horizontal lockup (mark + wordmark) at:`,
      `    ${join(ASSETS, 'logo-wordmark-source.svg')}`,
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const wordmarkSource = findSource('logo-wordmark-source')
const bg = brand.colors.brand

console.log(`\nLogo source: ${markSource.replace(`${MOBILE}/`, '')}`)
if (wordmarkSource) console.log(`Wordmark:    ${wordmarkSource.replace(`${MOBILE}/`, '')}`)
console.log(`Background:  ${bg}\n`)

const mark = await trimmed(markSource, 2048)

// 1. iOS + generic launcher icon — opaque, full bleed.
await emit(
  join(ASSETS, 'icon.png'),
  await centered({ logo: mark, size: 1024, scale: brand.iconScale, background: bg, stripAlpha: true }),
)

// 2. Android adaptive foreground — transparent, inset to the safe zone.
await emit(
  join(ASSETS, 'adaptive-icon.png'),
  await centered({ logo: mark, size: 1024, scale: brand.adaptiveScale, background: null }),
)

// 3. Splash — transparent, "contain" over splash.backgroundColor.
await emit(
  join(ASSETS, 'splash-icon.png'),
  await centered({ logo: mark, size: 1024, scale: brand.splashScale, background: null }),
)

// 4. Web favicon — opaque so it reads on a light browser tab strip.
await emit(
  join(ASSETS, 'favicon.png'),
  await centered({ logo: mark, size: 256, scale: 0.78, background: bg }),
)

// 5. In-app logo for the login screen — transparent, rendered on the dark hero.
await emit(
  join(ASSETS, 'logo-mark.png'),
  await centered({ logo: mark, size: 512, scale: 1.0, background: null }),
)

if (wordmarkSource) {
  const wide = await trimmed(wordmarkSource, 2048)
  await emit(join(ASSETS, 'logo-wordmark.png'), await sharp(wide).resize({ width: 1200 }).png().toBuffer())
}

// 6. Google Play store listing icon — 512x512, opaque.
await emit(
  join(STORE, 'android/icon-512.png'),
  await centered({ logo: mark, size: 512, scale: brand.iconScale, background: bg }),
)

// 7. A 1024 copy for App Store Connect, in case it is ever asked for outside
//    the binary (ASC normally reads the icon from the uploaded IPA).
await emit(
  join(STORE, 'ios/icon-1024.png'),
  await centered({ logo: mark, size: 1024, scale: brand.iconScale, background: bg, stripAlpha: true }),
)

// --- verify the store-critical invariants ----------------------------------

// [label, path, expected size, alpha policy]
//   'none'        no alpha channel at all (Apple marketing-icon rule)
//   'opaque'      alpha channel allowed, but nothing may be see-through (Play)
//   'transparent' transparency is the point (Android adaptive foreground)
const checks = [
  ['assets/icon.png', join(ASSETS, 'icon.png'), 1024, 'none'],
  ['store-assets/ios/icon-1024.png', join(STORE, 'ios/icon-1024.png'), 1024, 'none'],
  ['store-assets/android/icon-512.png', join(STORE, 'android/icon-512.png'), 512, 'opaque'],
  ['assets/adaptive-icon.png', join(ASSETS, 'adaptive-icon.png'), 1024, 'transparent'],
]

let failed = false
console.log('\nVerifying:')
for (const [label, path, size, alphaPolicy] of checks) {
  const meta = await sharp(path).metadata()
  const { isOpaque } = await sharp(path).stats()
  const sizeOk = meta.width === size && meta.height === size

  let alphaOk = true
  let alphaNote = ''
  if (alphaPolicy === 'none') {
    alphaOk = !meta.hasAlpha
    alphaNote = meta.hasAlpha ? 'HAS AN ALPHA CHANNEL (Apple rejects this)' : 'no alpha channel'
  } else if (alphaPolicy === 'opaque') {
    alphaOk = isOpaque
    alphaNote = isOpaque ? 'opaque' : 'HAS TRANSPARENCY (Play renders it black)'
  } else {
    alphaOk = meta.hasAlpha
    alphaNote = meta.hasAlpha ? 'transparent' : 'NO ALPHA (adaptive foreground needs it)'
  }

  if (!sizeOk || !alphaOk) failed = true
  console.log(`  ${sizeOk && alphaOk ? '✔' : '✘'} ${label} — ${meta.width}x${meta.height}, ${alphaNote}`)
}

if (failed) process.exit(1)
console.log('\nDone. Icons regenerated from the logo source.\n')
