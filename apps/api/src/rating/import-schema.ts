// ---------------------------------------------------------------------------
// Canonical tariff import format.
//
// A tariff's published rate data (currently just 400NG) is imported as this
// JSON shape rather than raw XLSX/PDF — XLSX parsing happens once, offline,
// via scripts/parse-400ng-xlsx.ts, so the API/DB layer only ever deals with
// a stable, versioned, zod-validated structure regardless of how the
// underlying workbook is laid out in a given tariff year.
//
// Shape verified against the real 2026 400NG Baseline Rates spreadsheet
// (Base Point City / Geographical Schedule / Linehaul / Additional Rates
// tabs) — see packages/domain/src/rating/tariff400ng.ts for the full
// calibration notes. No peak/non-peak split exists for any of these CONUS
// domestic rates, and pack/unpack are keyed by Service Schedule (1-4), not
// by Service Area directly.
// ---------------------------------------------------------------------------

import { z } from 'zod'

const Zip3Entry = z.object({
  zip3: z.string().regex(/^\d{3}$/, 'zip3 must be exactly 3 digits'),
  serviceArea: z.string().min(1),
})

const ServiceAreaEntry = z.object({
  serviceArea: z.string().min(1),
  schedule: z.number().int().min(1).max(4),
  serviceChargeCentsPerCwt: z.number().int().nonnegative(),
  linehaulFactorCentsPerCwt: z.number().int().nonnegative(),
})

const LinehaulRateEntry = z.object({
  milesLower: z.number().int().nonnegative(),
  milesUpper: z.number().int().positive(),
  weightLower: z.number().int().nonnegative(),
  weightUpper: z.number().int().positive(),
  rateCents: z.number().int().nonnegative(),
})

const ShorthaulRateEntry = z.object({
  cwtMilesLower: z.number().int().nonnegative(),
  cwtMilesUpper: z.number().int().positive(),
  rateCents: z.number().int().nonnegative(),
})

const PackRateEntry = z.object({
  schedule: z.number().int().min(1).max(4),
  weightLower: z.number().int().nonnegative(),
  weightUpper: z.number().int().positive(),
  rateCentsPerCwt: z.number().int().nonnegative(),
})

const UnpackRateEntry = z.object({
  schedule: z.number().int().min(1).max(4),
  rateMillicentsPerCwt: z.number().int().nonnegative(),
})

export const Tariff400ngImportSchema = z
  .object({
    schemaVersion: z.literal(1),
    tariffCode: z.literal('400NG'),
    label: z.string().min(1),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime(),
    zip3s: z.array(Zip3Entry).min(1),
    serviceAreas: z.array(ServiceAreaEntry).min(1),
    linehaulRates: z.array(LinehaulRateEntry).min(1),
    shorthaulRates: z.array(ShorthaulRateEntry).min(1),
    packRates: z.array(PackRateEntry),
    unpackRates: z.array(UnpackRateEntry),
  })
  .refine((doc) => new Date(doc.effectiveFrom) < new Date(doc.effectiveTo), {
    message: 'effectiveFrom must be before effectiveTo',
    path: ['effectiveFrom'],
  })

export type Tariff400ngImport = z.infer<typeof Tariff400ngImportSchema>
