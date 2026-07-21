// ---------------------------------------------------------------------------
// Scheduled Lambda — daily 400NG tariff coverage-staleness check.
//
// The 400NG tariff is loaded manually once a year (admin-web → Tariffs). Each
// TariffVersion has an effectiveTo; when the active version's window lapses
// with no successor imported, findActiveTariffVersion throws
// NO_ACTIVE_TARIFF_VERSION and ALL rating breaks — with no advance warning.
// USTRANSCOM publishes the next year's workbook behind a WAF (confirmed
// unfetchable), so there is no auto-ingest. This cron is the safeguard:
//
//   1. Coverage-days gauge (reliable, DB-only). Publishes TariffCoverageDays =
//      whole days until the active version's effectiveTo (0 when nothing is
//      ACTIVE — a real lapse). The MonitoringStack alarm pages when this drops
//      below 45, giving the team a comfortable window to download + import the
//      next workbook before rating breaks.
//   2. Best-effort artifact probe (optional, NEVER fails the run). GETs the
//      next rate year's USTRANSCOM Baseline Rates URL; it is expected to fail
//      (WAF-gated). If it ever unexpectedly 200s, logs at WARN and emits
//      TariffArtifactDetected=1 — a "the new tariff might be fetchable now"
//      signal for a human. There is NO auto-import.
//
// Scheduled DAILY (not monthly) in the CDK ApiStack EventBridge rule: the
// coverage alarm uses treatMissingData BREACHING (a missing gauge means the
// cron is down), and CloudWatch caps an alarm period at 1 day — so the gauge
// must land at least daily or BREACHING would page every day. The check is a
// single indexed DB read, so daily is negligible. Metric namespace/names are
// pinned in packages/infra/lib/metrics.ts; the strings are duplicated literally
// here because apps/api must not depend on @pegasus/infra — keep both in sync.
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { db } from './db'
import { createLogger } from './lib/logger'
import { getActiveTariffCoverageDays } from './repositories'

const logger = createLogger('pegasus-tariff-check')
const cloudwatch = new CloudWatchClient({})

// Keep these in sync with packages/infra/lib/metrics.ts (see file header).
const METRIC_NAMESPACE = 'Pegasus/Rating'
const TARIFF_COVERAGE_DAYS_METRIC = 'TariffCoverageDays'
const TARIFF_ARTIFACT_DETECTED_METRIC = 'TariffArtifactDetected'

const TARIFF_CODE = '400NG'

/**
 * URL pattern for a rate year's published 400NG Baseline Rates workbook. The
 * host is WAF-gated (Akamai edge denial, confirmed across curl/multiple user
 * agents), so this probe is expected to fail — a 200 is the notable event.
 */
function baselineRatesUrl(rateYear: number): string {
  return `https://www.ustranscom.mil/dp3/tariffs/${rateYear}-400ng-baseline-rates.xlsx`
}

/** Publishes a single datapoint; never throws (observability must not fail the run). */
async function publishMetric(metricName: string, value: number): Promise<void> {
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: [
          { MetricName: metricName, Value: value, Unit: 'Count', Timestamp: new Date() },
        ],
      }),
    )
  } catch (err) {
    logger.error('Failed to publish tariff-check metric', {
      metricName,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Best-effort probe of the next rate year's artifact URL. Swallows every error
 * and non-200 — the coverage gauge is the reliable duty, so a probe failure
 * (the normal case) must never affect the run.
 */
async function probeNextArtifact(nextRateYear: number): Promise<void> {
  const url = baselineRatesUrl(nextRateYear)
  try {
    const res = await fetch(url, { method: 'GET' })
    if (res.ok) {
      logger.warn('Next-year 400NG Baseline Rates artifact unexpectedly reachable', {
        url,
        status: res.status,
        rateYear: nextRateYear,
      })
      await publishMetric(TARIFF_ARTIFACT_DETECTED_METRIC, 1)
    } else {
      logger.info('Next-year 400NG artifact probe returned non-200 (expected — WAF-gated)', {
        status: res.status,
        rateYear: nextRateYear,
      })
    }
  } catch (err) {
    // Expected: the host is WAF-gated / unreachable. Info, not error.
    logger.info('Next-year 400NG artifact probe failed (expected — WAF-gated)', {
      rateYear: nextRateYear,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handler(): Promise<void> {
  // Reliable duty: publish the coverage-days gauge (0 when nothing is ACTIVE).
  const coverageDays = await getActiveTariffCoverageDays(db, TARIFF_CODE)
  logger.info('400NG tariff coverage checked', { tariffCode: TARIFF_CODE, coverageDays })
  await publishMetric(TARIFF_COVERAGE_DAYS_METRIC, coverageDays)

  // Best-effort probe of next spring's workbook. Never fails the run.
  const nextRateYear = new Date().getUTCFullYear() + 1
  await probeNextArtifact(nextRateYear)
}
