// ---------------------------------------------------------------------------
// Scheduled Lambda — emits RingCentral capture-health gauges to CloudWatch.
//
// One dedicated emitter (mirrors lambda-avp-store-count) keeps all the
// DB-derived health metrics in a single place with a single PutMetricData
// grant, rather than sprinkling metric calls across the sync/forward/renew
// crons. The MonitoringStack alarms key off these:
//   - OutboxPending        backlog building (on-prem down / slow)
//   - OutboxDead           forwards permanently failed → manual redrive needed
//   - SubscriptionsDead    webhook delivery broken
//   - ConnectionsUnhealthy token refresh / connection broken
//   - SyncLagSeconds       capture stalled (oldest cursor not advancing)
//
// The namespace + metric names are pinned in packages/infra/lib/metrics.ts;
// these literals must match (apps/api can't import @pegasus/infra). Inert-safe:
// with nothing captured every gauge is 0, so the NOT_BREACHING alarms stay
// green until the feature is enabled and something actually goes wrong.
// Scheduling lives in the CDK ApiStack (EventBridge rule, every 15 min).
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { db } from './db'
import { createLogger } from './lib/logger'

const logger = createLogger('pegasus-ringcentral-metrics')
const cloudwatch = new CloudWatchClient({})

const METRIC_NAMESPACE = 'Pegasus/RingCentral'

export async function handler(): Promise<void> {
  const now = Date.now()

  const [outboxPending, outboxDead, subscriptionsDead, connectionsUnhealthy, oldestCursor] =
    await Promise.all([
      db.messageForwardOutbox.count({ where: { status: { in: ['PENDING', 'FAILED'] } } }),
      db.messageForwardOutbox.count({ where: { status: 'DEAD' } }),
      db.ringCentralSubscription.count({ where: { status: { in: ['DEAD', 'BLACKLISTED'] } } }),
      db.ringCentralConnection.count({ where: { health: 'UNHEALTHY' } }),
      db.ringCentralSyncCursor.aggregate({ _min: { lastSyncAt: true } }),
    ])

  // Lag from the oldest cursor; 0 when no connection has synced yet (inert).
  const oldest = oldestCursor._min.lastSyncAt
  const syncLagSeconds = oldest ? Math.max(0, Math.round((now - oldest.getTime()) / 1000)) : 0

  logger.info('Emitting RingCentral health metrics', {
    outboxPending,
    outboxDead,
    subscriptionsDead,
    connectionsUnhealthy,
    syncLagSeconds,
  })

  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        { MetricName: 'OutboxPending', Value: outboxPending, Unit: 'Count' },
        { MetricName: 'OutboxDead', Value: outboxDead, Unit: 'Count' },
        { MetricName: 'SubscriptionsDead', Value: subscriptionsDead, Unit: 'Count' },
        { MetricName: 'ConnectionsUnhealthy', Value: connectionsUnhealthy, Unit: 'Count' },
        { MetricName: 'SyncLagSeconds', Value: syncLagSeconds, Unit: 'Seconds' },
      ],
    }),
  )
}
