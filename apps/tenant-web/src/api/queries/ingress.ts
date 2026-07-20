import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getIngress,
  provisionIngress,
  rotateIngress,
  decommissionIngress,
  testIngress,
} from '@/api/ingress'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const ingressKeys = {
  all: ['ingress'] as const,
  credential: (integrationId: string) => [...ingressKeys.all, 'credential', integrationId] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Credential metadata for an integration. A 404 (not provisioned) is an expected
 * state, not a transient error — don't retry it; the panel renders a provision
 * call-to-action instead.
 */
export const ingressQueryOptions = (integrationId: string) =>
  queryOptions({
    queryKey: ingressKeys.credential(integrationId),
    queryFn: () => getIngress(integrationId),
    enabled: integrationId.length > 0,
    retry: false,
  })

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Invalidate the credential metadata query for one integration. */
function useInvalidateIngress() {
  const qc = useQueryClient()
  return (integrationId: string) =>
    void qc.invalidateQueries({ queryKey: ingressKeys.credential(integrationId) })
}

/** Provision the first credential; returns the one-time token. */
export function useProvisionIngress() {
  const invalidate = useInvalidateIngress()
  return useMutation({
    mutationFn: (integrationId: string) => provisionIngress(integrationId),
    onSuccess: (res) => invalidate(res.integrationId),
  })
}

/** Rotate the credential; returns a new one-time token. */
export function useRotateIngress() {
  const invalidate = useInvalidateIngress()
  return useMutation({
    mutationFn: (integrationId: string) => rotateIngress(integrationId),
    onSuccess: (res) => invalidate(res.integrationId),
  })
}

/** Decommission (hard-delete) the credential. */
export function useDecommissionIngress() {
  const invalidate = useInvalidateIngress()
  return useMutation({
    mutationFn: (integrationId: string) => decommissionIngress(integrationId),
    onSuccess: (res) => invalidate(res.integrationId),
  })
}

/** Dry-run the published inbound behavior against a sample body (no invalidation). */
export function useTestIngress(integrationId: string) {
  return useMutation({
    mutationFn: (sample: unknown) => testIngress(integrationId, sample),
  })
}
