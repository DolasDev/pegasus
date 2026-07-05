#!/usr/bin/env node
/**
 * Generates packages/domain/src/rating/data/zip3-centroids.ts — a committed,
 * land-area-weighted centroid (lat/lon) for every 3-digit ZIP prefix in the
 * US Census Bureau's ZCTA Gazetteer file.
 *
 * These centroids back the rating engine's `createZip3CentroidEstimator`
 * (packages/domain/src/rating/mileage.ts): an approximate haversine-distance
 * mileage source used to rate a shipment when no official mileage source
 * (e.g. DTOD) is wired up. See dolas/agents/project/GOTCHAS.md if this ever
 * needs to be swapped for a more precise source.
 *
 * Usage:
 *   1. Download the current ZCTA Gazetteer file (public domain, no auth):
 *        curl -o /tmp/zcta.zip https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
 *        unzip /tmp/zcta.zip -d /tmp/zcta
 *   2. Run this script against the extracted .txt file:
 *        npx tsx scripts/generate-zip3-centroids.ts /tmp/zcta/2023_Gaz_zcta_national.txt
 *   3. Commit the regenerated packages/domain/src/rating/data/zip3-centroids.ts.
 *
 * This is a one-off/occasional dev tool (zip3 centroids barely drift year to
 * year) — it is not wired into any build or CI step.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GAZETTEER_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip'

const OUTPUT_PATH = resolve(
  import.meta.dirname,
  '../packages/domain/src/rating/data/zip3-centroids.ts',
)

function main(): void {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error(
      'Usage: npx tsx scripts/generate-zip3-centroids.ts <path-to-Gaz_zcta_national.txt>',
    )
    console.error(`Download the source file from:\n  ${GAZETTEER_URL}`)
    process.exit(1)
  }

  const raw = readFileSync(inputPath, 'utf-8')
  const lines = raw.split('\n')
  const header = lines[0]?.split('\t').map((h) => h.trim())
  if (!header || header[0] !== 'GEOID') {
    throw new Error(`Unexpected Gazetteer header — layout may have changed: ${header?.join(',')}`)
  }

  // Accumulate weighted-sum(lat), weighted-sum(lon), total-weight per zip3.
  // Weight = land area (ALAND_SQMI); a handful of zip5s are all-water (e.g.
  // some island territories) and get a tiny nominal weight so they still
  // contribute rather than being silently dropped.
  const acc = new Map<string, { latW: number; lonW: number; weight: number }>()

  for (const line of lines.slice(1)) {
    const cols = line.trimEnd().split('\t')
    if (cols.length < 7) continue
    const geoid = cols[0]?.trim() ?? ''
    if (!/^\d{5}$/.test(geoid)) continue

    const alandSqmi = Number(cols[3])
    const lat = Number(cols[5])
    const lon = Number(cols[6])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    const weight = Number.isFinite(alandSqmi) && alandSqmi > 0 ? alandSqmi : 0.001
    const zip3 = geoid.slice(0, 3)
    const entry = acc.get(zip3) ?? { latW: 0, lonW: 0, weight: 0 }
    entry.latW += lat * weight
    entry.lonW += lon * weight
    entry.weight += weight
    acc.set(zip3, entry)
  }

  const rows = [...acc.entries()]
    .filter(([, e]) => e.weight > 0)
    .map(([zip3, e]) => ({
      zip3,
      lat: Math.round((e.latW / e.weight) * 10_000) / 10_000,
      lon: Math.round((e.lonW / e.weight) * 10_000) / 10_000,
    }))
    .sort((a, b) => a.zip3.localeCompare(b.zip3))

  // Keys must be quoted: unquoted numeric-looking keys like `006` are a
  // leading-zero (legacy octal) numeric literal — a syntax error in strict
  // mode / ESM — and would silently collapse to the key "6" even if it
  // parsed, discarding the leading zeros that matter for a ZIP prefix.
  const body = rows.map((r) => `  '${r.zip3}': [${r.lat}, ${r.lon}],`).join('\n')

  const output = `// ---------------------------------------------------------------------------
// GENERATED FILE — do not hand-edit.
//
// Regenerate with:
//   npx tsx scripts/generate-zip3-centroids.ts <path-to-Gaz_zcta_national.txt>
// Source: US Census Bureau ${extractYear(inputPath)} ZCTA Gazetteer file (public domain)
//   ${GAZETTEER_URL}
//
// One row per 3-digit ZIP prefix: [latitude, longitude] of the land-area-
// weighted centroid of its member 5-digit ZCTAs. Used only for approximate
// (haversine) mileage estimation — see ../mileage.ts. Not survey-grade and
// not a substitute for an official mileage source (e.g. DTOD) when one is
// available.
// ---------------------------------------------------------------------------

/** 3-digit ZIP prefix -> [latitude, longitude] centroid. */
export const ZIP3_CENTROIDS: Readonly<Record<string, readonly [number, number]>> = {
${body}
}
`

  writeFileSync(OUTPUT_PATH, output)
  console.log(`Wrote ${rows.length} zip3 centroids to ${OUTPUT_PATH}`)
}

function extractYear(path: string): string {
  const match = /(\d{4})_Gaz/.exec(path)
  return match?.[1] ?? new Date().getFullYear().toString()
}

main()
