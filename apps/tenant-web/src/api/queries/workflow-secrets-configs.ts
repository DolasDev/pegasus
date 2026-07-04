import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listSecrets,
  createSecret,
  deleteSecret,
  listConfigs,
  createConfig,
  upsertConfig,
  deleteConfig,
} from '@/api/workflow-secrets-configs'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const workflowSecretConfigKeys = {
  all: ['workflow-secrets-configs'] as const,
  secrets: () => [...workflowSecretConfigKeys.all, 'secrets'] as const,
  configs: () => [...workflowSecretConfigKeys.all, 'configs'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const secretsQueryOptions = queryOptions({
  queryKey: workflowSecretConfigKeys.secrets(),
  queryFn: () => listSecrets(),
})

export const configsQueryOptions = queryOptions({
  queryKey: workflowSecretConfigKeys.configs(),
  queryFn: () => listConfigs(),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function useCreateSecret() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { key: string; value: string; group?: string; description?: string }) =>
      createSecret(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowSecretConfigKeys.secrets() })
    },
  })
}

export function useDeleteSecret() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, group }: { key: string; group: string }) => deleteSecret(key, group),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowSecretConfigKeys.secrets() })
    },
  })
}

export function useCreateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { key: string; value: string; group?: string; description?: string }) =>
      createConfig(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowSecretConfigKeys.configs() })
    },
  })
}

export function useUpsertConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      key,
      data,
    }: {
      key: string
      data: { value: string; group?: string; description?: string | null }
    }) => upsertConfig(key, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowSecretConfigKeys.configs() })
    },
  })
}

export function useDeleteConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, group }: { key: string; group: string }) => deleteConfig(key, group),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowSecretConfigKeys.configs() })
    },
  })
}
