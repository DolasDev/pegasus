// ---------------------------------------------------------------------------
// Scheduled Lambda — weekly 400NG fuel-surcharge (Item 16) refresh from EIA.
//
// Fetches the latest weekly U.S. national average on-highway No. 2 diesel
// retail price from the EIA v2 API and upserts a TariffFuelSurcharge row
// (source EIA_AUTO); the surcharge percentage is derived from the price by the
// repository via the domain's fscPercentForDieselPrice (Item 16: 1% per $0.13
// over the $3.50 baseline). Effective date = the EIA survey week (a Monday), so
// each week's surcharge applies to pickups from that Monday until the next run.
//
// INERT until an operator provisions the API-key secret (out-of-band, per the
// repo's secret convention — see the CDK block in api-stack.ts). The Lambda
// reads the key from Secrets Manager AT RUNTIME by the name in
// EIA_API_KEY_SECRET_NAME, so the moment the secret is created the next weekly
// run picks it up — no redeploy needed. Missing/empty secret → logged no-op.
//
// Scheduling (weekly, Tuesday+ after EIA's Tuesday publish) lives in the CDK
// ApiStack EventBridge rule. Metric namespace/name are pinned in
// packages/infra/lib/metrics.ts; the strings are duplicated literally here
// because apps/api must not depend on @pegasus/infra — keep both in sync.
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager'
import { db } from './db'
import { createLogger } from './lib/logger'
import { upsertTariffFuelSurcharge } from './repositories'

const logger = createLogger('pegasus-tariff-fsc-update')
const cloudwatch = new CloudWatchClient({})
const secretsManager = new SecretsManagerClient({})

// Keep these in sync with packages/infra/lib/metrics.ts (see file header).
const METRIC_NAMESPACE = 'Pegasus/Rating'
const FSC_UPDATE_SUCCESS_METRIC = 'FscUpdateSuccess'
const FSC_UPDATE_FAILURE_METRIC = 'FscUpdateFailure'

const TARIFF_CODE = '400NG'

// Weekly U.S. national on-highway No. 2 diesel retail price ($/gal).
const EIA_SERIES_ID = 'PET.EMD_EPD2D_PTE_NUS_DPG.W'

interface LatestDieselPrice {
  /** Integer cents per gallon (EIA reports $/gal; ×100, rounded). */
  readonly centsPerGallon: number
  /** Survey week — a Monday (UTC midnight). */
  readonly effectiveFrom: Date
}

/**
 * Reads the EIA API key from Secrets Manager at runtime. Returns null (→ no-op)
 * when the secret name is unset, the secret does not exist yet, or its value is
 * empty — the inert-until-configured contract.
 */
async function readEiaApiKey(): Promise<string | null> {
  const secretName = process.env['EIA_API_KEY_SECRET_NAME']
  if (!secretName) return null
  try {
    const out = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretName }))
    const key = out.SecretString?.trim()
    return key ? key : null
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return null
    throw err
  }
}

/** Fetches the single most-recent weekly national diesel price from EIA. */
async function fetchLatestDieselPrice(apiKey: string): Promise<LatestDieselPrice> {
  const url = `https://api.eia.gov/v2/seriesid/${EIA_SERIES_ID}?api_key=${encodeURIComponent(
    apiKey,
  )}&length=1`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`EIA API returned ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    response?: { data?: Array<{ value?: string | number; period?: string }> }
  }
  const point = json.response?.data?.[0]
  if (point?.value == null || !point.period) {
    throw new Error(`EIA API returned no data point for series ${EIA_SERIES_ID}`)
  }
  const dollarsPerGallon = Number(point.value)
  if (!Number.isFinite(dollarsPerGallon)) {
    throw new Error(`EIA API returned a non-numeric price: ${String(point.value)}`)
  }
  return {
    centsPerGallon: Math.round(dollarsPerGallon * 100),
    effectiveFrom: new Date(`${point.period}T00:00:00.000Z`),
  }
}

/** Publishes a single count metric; never throws (observability must not fail the run). */
async function publishMetric(metricName: string): Promise<void> {
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: [{ MetricName: metricName, Value: 1, Unit: 'Count', Timestamp: new Date() }],
      }),
    )
  } catch (err) {
    logger.error('Failed to publish FSC-update metric', {
      metricName,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handler(): Promise<void> {
  const apiKey = await readEiaApiKey()
  if (!apiKey) {
    logger.info('EIA API key not configured — skipping fuel-surcharge refresh')
    return
  }

  try {
    const { centsPerGallon, effectiveFrom } = await fetchLatestDieselPrice(apiKey)
    const row = await upsertTariffFuelSurcharge(db, {
      tariffCode: TARIFF_CODE,
      effectiveFrom,
      dieselPriceCentsPerGallon: centsPerGallon,
      source: 'EIA_AUTO',
    })
    logger.info('Fuel surcharge refreshed from EIA', {
      effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
      dieselPriceCentsPerGallon: centsPerGallon,
      percentBps: row.percentBps,
    })
    await publishMetric(FSC_UPDATE_SUCCESS_METRIC)
  } catch (err) {
    logger.error('Fuel-surcharge refresh failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    await publishMetric(FSC_UPDATE_FAILURE_METRIC)
    throw err
  }
}
