// ---------------------------------------------------------------------------
// Scheduled Lambda — emits the per-account AVP policy-store count to CloudWatch
//
// AWS Verified Permissions has a soft limit of ~100 policy stores per Region
// per AWS account. Pegasus provisions one store per tenant, so the count is
// also our active-tenant count in the AVP plane. Crossing 80 means we should
// file an AWS support ticket to raise the quota before onboarding more.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule, hourly). The metric
// namespace + name are pinned in packages/infra/lib/metrics.ts so the
// MonitoringStack alarms and dashboard widget reference the same string.
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { db } from './db'
import { createLogger } from './lib/logger'

const logger = createLogger('pegasus-avp-store-count')
const cloudwatch = new CloudWatchClient({})

const METRIC_NAMESPACE = 'Pegasus/Authorization'
const METRIC_NAME = 'PolicyStoreCount'

export async function handler(): Promise<void> {
  const count = await db.tenant.count({ where: { policyStoreId: { not: null } } })

  logger.info('Emitting AVP policy-store count metric', { count })

  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        {
          MetricName: METRIC_NAME,
          Value: count,
          Unit: 'Count',
          Timestamp: new Date(),
        },
      ],
    }),
  )
}
