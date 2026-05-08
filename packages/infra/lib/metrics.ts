// ---------------------------------------------------------------------------
// Custom CloudWatch metric constants — used by the CDK stacks that build the
// alarms and dashboard widgets. The publisher side
// (apps/api/src/lambda-avp-store-count.ts) repeats the same strings literally
// rather than importing from here: apps/api does not depend on
// @pegasus/infra, and reversing that dep direction would let CDK code reach
// into the API bundle (and vice-versa). Duplication is the cheaper trade.
// If either string changes here, update the matching constant in the
// publisher in the same commit.
// ---------------------------------------------------------------------------

export const PEGASUS_AUTHZ_METRIC_NAMESPACE = 'Pegasus/Authorization'

/**
 * Count of `tenants` rows with a non-null `policy_store_id`. Emitted hourly
 * by the avp-store-count scheduled Lambda. AWS Verified Permissions has a
 * soft limit of ~100 policy stores per Region per AWS account; we provision
 * one per tenant, so this is also the active-tenant count in the AVP plane.
 *
 * Alarm thresholds (in MonitoringStack):
 *   - 60 → informational ("plan ahead")
 *   - 80 → critical ("file an AWS support ticket NOW to raise the quota")
 */
export const AVP_POLICY_STORE_COUNT_METRIC_NAME = 'PolicyStoreCount'
