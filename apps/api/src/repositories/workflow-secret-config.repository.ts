// ---------------------------------------------------------------------------
// WorkflowSecretConfig repository
//
// Per-tenant secrets/config store read by running workflows via the SDK. One
// table, two kinds (SECRET | CONFIG) discriminated by `kind`. Always owned by a
// single tenant, so the model lives in TENANT_SCOPED_MODELS — every read/write
// below picks up the current tenant via the Prisma extension.
//
// This is the raw writer. The handler owns: key-format validation, the
// SECRET-vs-CONFIG column discipline (SECRET ⇒ valueCiphertext set, value null;
// CONFIG ⇒ value set, valueCiphertext null), KMS encrypt/decrypt, and the
// never-return-secret-plaintext response rule. `isSecret` is stamped from `kind`
// here so callers never set it by hand.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient, WorkflowSecretConfigKind } from '@prisma/client'

export type { WorkflowSecretConfigKind }

export type WorkflowSecretConfigRow = {
  id: string
  tenantId: string
  kind: WorkflowSecretConfigKind
  group: string
  key: string
  value: string | null
  valueCiphertext: string | null
  isSecret: boolean
  description: string | null
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  kind: true,
  group: true,
  key: true,
  value: true,
  valueCiphertext: true,
  isSecret: true,
  description: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

export function createWorkflowSecretConfigRepository(db: PrismaClient) {
  return {
    /**
     * Insert a new secret/config row. The caller passes tenantId explicitly
     * (the create path is not rewritten by the tenant extension) and is
     * responsible for the column discipline per kind. `isSecret` is derived
     * from `kind`.
     */
    async create(input: {
      tenantId: string
      kind: WorkflowSecretConfigKind
      group: string
      key: string
      value?: string | null
      valueCiphertext?: string | null
      description?: string | null
      createdByUserId: string
    }): Promise<WorkflowSecretConfigRow> {
      const data: Prisma.WorkflowSecretConfigUncheckedCreateInput = {
        tenantId: input.tenantId,
        kind: input.kind,
        group: input.group,
        key: input.key,
        value: input.value ?? null,
        valueCiphertext: input.valueCiphertext ?? null,
        isSecret: input.kind === 'SECRET',
        description: input.description ?? null,
        createdByUserId: input.createdByUserId,
      }
      return db.workflowSecretConfig.create({ data, select: SELECT })
    },

    /** Tenant-scoped fetch by (kind, group, key) — the unique lookup. */
    async findByKey(
      kind: WorkflowSecretConfigKind,
      group: string,
      key: string,
    ): Promise<WorkflowSecretConfigRow | null> {
      return db.workflowSecretConfig.findFirst({ where: { kind, group, key }, select: SELECT })
    },

    /**
     * Tenant-scoped list of one kind, ordered by group then key. Pass `group`
     * to list a single group; omit it to list every group for the kind.
     */
    async listByKind(
      kind: WorkflowSecretConfigKind,
      group?: string,
    ): Promise<WorkflowSecretConfigRow[]> {
      return db.workflowSecretConfig.findMany({
        where: group === undefined ? { kind } : { kind, group },
        orderBy: [{ group: 'asc' }, { key: 'asc' }],
        select: SELECT,
      })
    },

    /**
     * Partial update by id. Pass `null` for `description` to clear it; omit a
     * field to leave it untouched. Only CONFIG rows are updated (secrets are
     * write-once) — enforced by the handler.
     */
    async update(
      id: string,
      input: { value?: string; valueCiphertext?: string; description?: string | null },
    ): Promise<WorkflowSecretConfigRow> {
      const data: Prisma.WorkflowSecretConfigUncheckedUpdateInput = {}
      if (input.value !== undefined) data.value = input.value
      if (input.valueCiphertext !== undefined) data.valueCiphertext = input.valueCiphertext
      if (input.description !== undefined) data.description = input.description
      return db.workflowSecretConfig.update({ where: { id }, data, select: SELECT })
    },

    /**
     * Tenant-scoped hard delete by (kind, group, key). Uses deleteMany so a
     * missing key is a no-op (returns count 0) rather than throwing — the
     * handler maps count 0 to 404.
     */
    async deleteByKey(kind: WorkflowSecretConfigKind, group: string, key: string): Promise<number> {
      const result = await db.workflowSecretConfig.deleteMany({ where: { kind, group, key } })
      return result.count
    },
  }
}

export type WorkflowSecretConfigRepository = ReturnType<typeof createWorkflowSecretConfigRepository>
