// ---------------------------------------------------------------------------
// CloudWatch metric for a failed usage-meter write: Pegasus/Usage
// MeterWriteFailed{Action}. The meter never fails the action it meters, so this
// metric (and its alarm in packages/infra) is the only backstop against a
// silent under-count.
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { logger } from '../logger'

// Duplicated from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as every other emitter.
export const USAGE_METRIC_NAMESPACE = 'Pegasus/Usage'

const cloudwatch = new CloudWatchClient({})

/** Observability, not correctness: a CloudWatch hiccup is logged, never thrown. */
export async function emitMeterWriteFailed(action: string): Promise<void> {
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: USAGE_METRIC_NAMESPACE,
        // Two datapoints: the per-Action series for diagnosis, and a
        // dimensionless one so a single alarm covers every action.
        MetricData: [
          {
            MetricName: 'MeterWriteFailed',
            Value: 1,
            Unit: 'Count',
            Timestamp: new Date(),
            Dimensions: [{ Name: 'Action', Value: action }],
          },
          {
            MetricName: 'MeterWriteFailed',
            Value: 1,
            Unit: 'Count',
            Timestamp: new Date(),
          },
        ],
      }),
    )
  } catch (err) {
    logger.error('Failed to publish usage MeterWriteFailed metric', {
      action,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
