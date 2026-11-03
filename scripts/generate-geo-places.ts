#!/usr/bin/env node
/**
 * Generates the Prisma data migration that loads `geo_cities` and
 * `geo_postal_codes` — the reference data behind the Labor module's
 * nearest-first crew search and its service-area city typeahead
 * (apps/api/src/handlers/labor.ts).
 *
 * Sources (download, unzip, pass the extracted .txt files):
 *   - Cities, US + Canada — GeoNames `cities500` (every populated place with
 *     500+ people; CC-BY 4.0, attribution shown in the mobile app):
 *       https://download.geonames.org/export/dump/cities500.zip
 *   - US ZIP5 centroids — Census Bureau ZCTA Gazetteer (public domain):
 *       https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
 *   - Canadian FSA centroids — GeoNames postal codes for CA (CC-BY 4.0):
 *       https://download.geonames.org/export/zip/CA.zip
 *
 * Usage:
 *   npx tsx scripts/generate-geo-places.ts <cities500.txt> <Gaz_zcta_national.txt> <CA.txt> <migration-dir-name>
 *
 * The ZCTA file has no state column, so a ZIP's state is taken from the nearest
 * US city — good enough for a display label; nothing ranks on it.
 *
 * This is a one-off/occasional dev tool, like generate-zip3-centroids.ts — not
 * wired into any build or CI step. A refresh is a NEW migration that truncates
 * and reloads (service areas keep their copied lat/lon; `geo_city_id` is SET
 * NULL on delete), never an edit of an applied one.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldKey } from '../packages/domain/src/labor/index'

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../apps/api/prisma/migrations')
const BATCH = 1000

/** GeoNames admin1 codes for Canada → postal abbreviations. */
const CA_ADMIN1: Record<string, string> = {
  '01': 'AB',
  '02': 'BC',
  '03': 'MB',
  '04': 'NB',
  '05': 'NL',
  '07': 'NS',
  '08': 'ON',
  '09': 'PE',
  '10': 'QC',
  '11': 'SK',
  '12': 'YT',
  '13': 'NT',
  '14': 'NU',
}

/** GeoNames feature codes that are not a place someone would call a city. */
const SKIP_FEATURES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'])

interface City {
  id: string
  country: 'US' | 'CA'
  region: string
  name: string
  nameKey: string
  lat: number
  lon: number
  population: number | null
}

interface Postal {
  country: 'US' | 'CA'
  code: string
  region: string
  lat: number
  lon: number
}

function readCities(path: string): City[] {
  const cities: City[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const f = line.split('\t')
    if (f.length < 15) continue
    const country = f[8]
    if (country !== 'US' && country !== 'CA') continue
    if (SKIP_FEATURES.has(f[7]!)) continue
    const region = country === 'CA' ? CA_ADMIN1[f[10]!] : f[10]
    if (!region || !/^[A-Z]{2}$/.test(region)) continue
    const name = f[1]!.trim()
    const population = Number(f[14])
    cities.push({
      id: `gn:${f[0]}`,
      country,
      region,
      name,
      nameKey: foldKey(name),
      lat: Number(f[4]),
      lon: Number(f[5]),
      population: Number.isFinite(population) && population > 0 ? population : null,
    })
  }
  return cities
}

/** Nearest-city lookup over a 1° grid — for labelling ZIPs with a state. */
function nearestRegion(cities: readonly City[]): (lat: number, lon: number) => string | undefined {
  const grid = new Map<string, City[]>()
  const key = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`
  for (const c of cities) {
    const k = key(c.lat, c.lon)
    let cell = grid.get(k)
    if (!cell) grid.set(k, (cell = []))
    cell.push(c)
  }
  return (lat, lon) => {
    for (let radius = 0; radius <= 6; radius++) {
      let best: City | undefined
      let bestD = Infinity
      for (let dLat = -radius; dLat <= radius; dLat++) {
        for (let dLon = -radius; dLon <= radius; dLon++) {
          for (const c of grid.get(key(lat + dLat, lon + dLon)) ?? []) {
            const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
            if (d < bestD) {
              bestD = d
              best = c
            }
          }
        }
      }
      if (best) return best.region
    }
    return undefined
  }
}

function readZctas(
  path: string,
  regionAt: (lat: number, lon: number) => string | undefined,
): Postal[] {
  const out: Postal[] = []
  for (const line of readFileSync(path, 'utf8').split('\n').slice(1)) {
    const f = line.trim().split('\t')
    if (f.length < 7 || !/^\d{5}$/.test(f[0]!)) continue
    const lat = Number(f[5])
    const lon = Number(f[6])
    const region = regionAt(lat, lon)
    if (!region) continue
    out.push({ country: 'US', code: f[0]!, region, lat, lon })
  }
  return out
}

function readFsas(path: string): Postal[] {
  const out: Postal[] = []
  const seen = new Set<string>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const f = line.split('\t')
    if (f.length < 11 || f[0] !== 'CA' || !/^[A-Z]\d[A-Z]$/.test(f[1]!)) continue
    const region = f[4]!
    if (!/^[A-Z]{2}$/.test(region)) continue
    if (seen.has(f[1]!)) continue // GeoNames repeats an FSA that straddles places
    seen.add(f[1]!)
    out.push({ country: 'CA', code: f[1]!, region, lat: Number(f[9]), lon: Number(f[10]) })
  }
  return out
}

const sql = (v: string | number | null): string =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`

function inserts(
  table: string,
  columns: string[],
  rows: Array<Array<string | number | null>>,
): string {
  const parts: string[] = []
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows
      .slice(i, i + BATCH)
      .map((r) => `(${r.map(sql).join(',')})`)
      .join(',\n')
    parts.push(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES\n${values};`,
    )
  }
  return parts.join('\n\n')
}

function main(): void {
  const [citiesPath, zctaPath, caPath, migrationName] = process.argv.slice(2)
  if (!citiesPath || !zctaPath || !caPath || !migrationName) {
    console.error(
      'Usage: npx tsx scripts/generate-geo-places.ts <cities500.txt> <Gaz_zcta_national.txt> <CA.txt> <migration-dir-name>',
    )
    process.exit(1)
  }

  const cities = readCities(citiesPath)
  const usCities = cities.filter((c) => c.country === 'US')
  const postals = [...readZctas(zctaPath, nearestRegion(usCities)), ...readFsas(caPath)]

  const body = [
    '-- Generated by scripts/generate-geo-places.ts — do not edit by hand.',
    '-- Cities: GeoNames cities500 (CC-BY 4.0, https://www.geonames.org). US ZIP5:',
    '-- Census Bureau ZCTA Gazetteer 2023 (public domain). Canadian FSAs: GeoNames',
    '-- postal codes (CC-BY 4.0).',
    '',
    inserts(
      'geo_cities',
      ['id', 'country', 'region', 'name', 'name_key', 'lat', 'lon', 'population'],
      cities.map((c) => [c.id, c.country, c.region, c.name, c.nameKey, c.lat, c.lon, c.population]),
    ),
    '',
    inserts(
      'geo_postal_codes',
      ['country', 'code', 'region', 'lat', 'lon'],
      postals.map((p) => [p.country, p.code, p.region, p.lat, p.lon]),
    ),
    '',
  ].join('\n')

  const dir = resolve(MIGRATIONS_DIR, migrationName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'migration.sql'), body)
  console.log(
    `Wrote ${cities.length} cities (${usCities.length} US) and ${postals.length} postal codes to ${dir}/migration.sql`,
  )
}

main()
