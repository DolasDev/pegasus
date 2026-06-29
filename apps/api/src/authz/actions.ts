// ---------------------------------------------------------------------------
// Cedar action catalog.
//
// The single source of truth for every action the API can authorize. The same
// catalog drives:
//   - the `cedar.schema.json` `appliesTo` matrix (verified by our own check at
//     module load via the wasm validator in tests)
//   - `requirePermission(Actions.X)` mounts in handlers
//   - `GET /api/v1/me/permissions` — `permission` is the public-facing string
//     returned to clients (resource:verb)
//
// Adding a new action:
//   1) Add an entry here with a unique key and a unique `id`.
//   2) Add the action to `cedar.schema.json` `actions` map with appliesTo.
//   3) Reference it in a `permit (...)` policy file under `policies/`.
//   4) Mount `requirePermission(Actions.NewAction)` on the route.
// ---------------------------------------------------------------------------

/** Cedar namespace prefix for every entity type and action defined here. */
export const PEGASUS_NS = 'Pegasus' as const

export type ResourceType =
  | 'User'
  | 'Quote'
  | 'Move'
  | 'Invoice'
  | 'Customer'
  | 'ApiClient'
  | 'Setting'
  | 'Order'
  | 'Event'
  | 'Workflow'
  | 'WorkflowSecretConfig'
  | 'Notification'
  | 'IntegrationConfig'
  | 'IntegrationProjection'
  | 'EventType'

export interface ActionDef {
  /** Cedar action identifier (without namespace prefix). */
  readonly id: string
  /** Resource entity type the action applies to. */
  readonly resourceType: ResourceType
  /** Public-facing permission string returned by /me/permissions. */
  readonly permission: string
}

/**
 * The complete action catalog.
 *
 * NOTE: keep this object literal — `as const` plus the explicit return type on
 * `ALL_ACTIONS` lets TypeScript narrow `Actions.X.id` to the exact string
 * literal, which is useful in tests.
 */
export const Actions = {
  // ── Users (tenant-user roster management) ────────────────────────────────
  ListUsers: {
    id: 'ListUsers',
    resourceType: 'User',
    permission: 'user:list',
  },
  InviteUser: {
    id: 'InviteUser',
    resourceType: 'User',
    permission: 'user:invite',
  },
  UpdateUser: {
    id: 'UpdateUser',
    resourceType: 'User',
    permission: 'user:update',
  },
  DeactivateUser: {
    id: 'DeactivateUser',
    resourceType: 'User',
    permission: 'user:deactivate',
  },
  // ── Settings ────────────────────────────────────────────────────────────
  ReadSettings: {
    id: 'ReadSettings',
    resourceType: 'Setting',
    permission: 'setting:read',
  },
  UpdateSettings: {
    id: 'UpdateSettings',
    resourceType: 'Setting',
    permission: 'setting:update',
  },
  // ── Integrations ──────────────────────────────────────────────────────────
  ManageRingCentralIntegration: {
    id: 'ManageRingCentralIntegration',
    resourceType: 'Setting',
    permission: 'ringcentral:manage',
  },
  // ── API clients (M2M key administration) ────────────────────────────────
  ListApiClients: {
    id: 'ListApiClients',
    resourceType: 'ApiClient',
    permission: 'api_client:list',
  },
  CreateApiClient: {
    id: 'CreateApiClient',
    resourceType: 'ApiClient',
    permission: 'api_client:create',
  },
  RotateApiClient: {
    id: 'RotateApiClient',
    resourceType: 'ApiClient',
    permission: 'api_client:rotate',
  },
  RevokeApiClient: {
    id: 'RevokeApiClient',
    resourceType: 'ApiClient',
    permission: 'api_client:revoke',
  },
  // ── Quotes ──────────────────────────────────────────────────────────────
  ReadQuote: { id: 'ReadQuote', resourceType: 'Quote', permission: 'quote:read' },
  CreateQuote: { id: 'CreateQuote', resourceType: 'Quote', permission: 'quote:create' },
  UpdateQuote: { id: 'UpdateQuote', resourceType: 'Quote', permission: 'quote:update' },
  DeleteQuote: { id: 'DeleteQuote', resourceType: 'Quote', permission: 'quote:delete' },
  // ── Moves ───────────────────────────────────────────────────────────────
  ListMoves: { id: 'ListMoves', resourceType: 'Move', permission: 'move:list' },
  ReadMove: { id: 'ReadMove', resourceType: 'Move', permission: 'move:read' },
  CreateMove: { id: 'CreateMove', resourceType: 'Move', permission: 'move:create' },
  UpdateMove: { id: 'UpdateMove', resourceType: 'Move', permission: 'move:update' },
  DeleteMove: { id: 'DeleteMove', resourceType: 'Move', permission: 'move:delete' },
  // ── Invoices ────────────────────────────────────────────────────────────
  ReadInvoice: { id: 'ReadInvoice', resourceType: 'Invoice', permission: 'invoice:read' },
  CreateInvoice: { id: 'CreateInvoice', resourceType: 'Invoice', permission: 'invoice:create' },
  UpdateInvoice: { id: 'UpdateInvoice', resourceType: 'Invoice', permission: 'invoice:update' },
  DeleteInvoice: { id: 'DeleteInvoice', resourceType: 'Invoice', permission: 'invoice:delete' },
  // ── Customers ───────────────────────────────────────────────────────────
  ReadCustomer: { id: 'ReadCustomer', resourceType: 'Customer', permission: 'customer:read' },
  CreateCustomer: {
    id: 'CreateCustomer',
    resourceType: 'Customer',
    permission: 'customer:create',
  },
  UpdateCustomer: {
    id: 'UpdateCustomer',
    resourceType: 'Customer',
    permission: 'customer:update',
  },
  DeleteCustomer: {
    id: 'DeleteCustomer',
    resourceType: 'Customer',
    permission: 'customer:delete',
  },
  // ── Orders (legacy on-prem orders integration; M2M-only surface) ────────
  ReadOrder: { id: 'ReadOrder', resourceType: 'Order', permission: 'order:read' },
  CreateOrder: { id: 'CreateOrder', resourceType: 'Order', permission: 'order:create' },
  // ── Events (inbound platform event queue; M2M-only surface) ─────────────
  ReadEvent: { id: 'ReadEvent', resourceType: 'Event', permission: 'event:read' },
  CreateEvent: { id: 'CreateEvent', resourceType: 'Event', permission: 'event:create' },
  UpdateEvent: { id: 'UpdateEvent', resourceType: 'Event', permission: 'event:update' },
  DeleteEvent: { id: 'DeleteEvent', resourceType: 'Event', permission: 'event:delete' },
  // ── Workflows (Python workflow artifacts; SDK upload + tenant listing) ──
  ReadWorkflow: {
    id: 'ReadWorkflow',
    resourceType: 'Workflow',
    permission: 'workflow:read',
  },
  UploadWorkflow: {
    id: 'UploadWorkflow',
    resourceType: 'Workflow',
    permission: 'workflow:upload',
  },
  RunWorkflow: {
    id: 'RunWorkflow',
    resourceType: 'Workflow',
    permission: 'workflow:run',
  },
  ManageWorkflowTriggers: {
    id: 'ManageWorkflowTriggers',
    resourceType: 'Workflow',
    permission: 'workflow:manage_triggers',
  },
  CancelWorkflowExecution: {
    id: 'CancelWorkflowExecution',
    resourceType: 'Workflow',
    permission: 'workflow:cancel_execution',
  },
  RetryWorkflowExecution: {
    id: 'RetryWorkflowExecution',
    resourceType: 'Workflow',
    permission: 'workflow:retry_execution',
  },
  // ── Notifications (staff-initiated push to drivers/crew) ────────────────────
  SendNotification: {
    id: 'SendNotification',
    resourceType: 'Notification',
    permission: 'notification:send',
  },
  // ── SMS (outbound RingCentral SMS via the workflow runtime) ─────────────────
  SendSms: {
    id: 'SendSms',
    resourceType: 'Notification',
    permission: 'sms:send',
  },
  // ── Integration validator config (mapping + rules; SDK/CLI publish) ──────
  ReadIntegrationConfig: {
    id: 'ReadIntegrationConfig',
    resourceType: 'IntegrationConfig',
    permission: 'integration_config:read',
  },
  PublishIntegrationConfig: {
    id: 'PublishIntegrationConfig',
    resourceType: 'IntegrationConfig',
    permission: 'integration_config:publish',
  },
  // ── Custom event types (tenant-defined event registry for workflows) ─────
  ManageEventTypes: {
    id: 'ManageEventTypes',
    resourceType: 'EventType',
    permission: 'event_type:manage',
  },
  EmitTenantEvent: {
    id: 'EmitTenantEvent',
    resourceType: 'EventType',
    permission: 'event_type:emit',
  },
  // ── Workflow secrets & config (per-tenant key/value read at runtime) ──────
  // Manage* gate the Cognito management surface (tenant_admin / workflow_developer);
  // Read* gate the vnd_ runtime read and are granted to workflow_runtime so a
  // running workflow can fetch values it declared in its manifest required_actions.
  ManageWorkflowSecrets: {
    id: 'ManageWorkflowSecrets',
    resourceType: 'WorkflowSecretConfig',
    permission: 'workflow_secret:manage',
  },
  ReadWorkflowSecret: {
    id: 'ReadWorkflowSecret',
    resourceType: 'WorkflowSecretConfig',
    permission: 'workflow_secret:read',
  },
  ManageWorkflowConfigs: {
    id: 'ManageWorkflowConfigs',
    resourceType: 'WorkflowSecretConfig',
    permission: 'workflow_config:manage',
  },
  ReadWorkflowConfig: {
    id: 'ReadWorkflowConfig',
    resourceType: 'WorkflowSecretConfig',
    permission: 'workflow_config:read',
  },
  // ── Integration projections (per-record external-state cache for workflows) ─
  // Read* gates both the SDK runtime read and the validator's prior-state lookup;
  // Write* gates the SDK upsert/delete. Both are granted to workflow_runtime so a
  // running workflow can mirror the external system and the validator can read it
  // under the same vnd_ runtime token.
  ReadIntegrationProjection: {
    id: 'ReadIntegrationProjection',
    resourceType: 'IntegrationProjection',
    permission: 'integration_projection:read',
  },
  WriteIntegrationProjection: {
    id: 'WriteIntegrationProjection',
    resourceType: 'IntegrationProjection',
    permission: 'integration_projection:write',
  },
} as const satisfies Record<string, ActionDef>

export type ActionKey = keyof typeof Actions

/** Frozen array of every action — used by tests and listAllowedPermissions. */
export const ALL_ACTIONS: readonly ActionDef[] = Object.freeze(
  Object.values(Actions) as ActionDef[],
)

/** Read actions that the baseline `tenant_user` policy permits. */
export const READ_ACTION_IDS: ReadonlySet<string> = new Set([
  Actions.ReadQuote.id,
  Actions.ReadMove.id,
  Actions.ReadInvoice.id,
  Actions.ReadCustomer.id,
  Actions.ReadWorkflow.id,
])
