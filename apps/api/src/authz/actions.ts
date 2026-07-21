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
  | 'Tariff'
  | 'Move'
  | 'Invoice'
  | 'Customer'
  | 'ApiClient'
  | 'Setting'
  | 'Order'
  | 'Salesman'
  | 'Task'
  | 'Event'
  | 'Workflow'
  | 'WorkflowSecretConfig'
  | 'Notification'
  | 'IntegrationConfig'
  | 'IntegrationProjection'
  | 'EventType'
  | 'Blob'

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
  ReactivateUser: {
    id: 'ReactivateUser',
    resourceType: 'User',
    permission: 'user:reactivate',
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
  // Registering an IdP is equivalent to minting claims for this tenant: a
  // federated login resolves its tenant from the provider, then takes the
  // roles of whatever email it asserts. So this gates reads too -- one action,
  // admin-only, no read/manage split.
  ManageSsoProviders: {
    id: 'ManageSsoProviders',
    resourceType: 'Setting',
    permission: 'sso:manage',
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
  // ── Tariffs (rating engine — global reference data, e.g. 400NG) ──────────
  // RateShipment/ReadTariff are open to standard tenant roles (see
  // policies/20-viewer.cedar). There is deliberately NO tenant-facing
  // import/activate action: mutating the platform-global tariff data every
  // tenant shares belongs on the PLATFORM_ADMIN surface (POST /api/admin/tariffs,
  // handlers/admin/tariffs.ts), not behind any tenant's Cedar grant.
  RateShipment: { id: 'RateShipment', resourceType: 'Tariff', permission: 'tariff:rate' },
  ReadTariff: { id: 'ReadTariff', resourceType: 'Tariff', permission: 'tariff:read' },
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
  // ── Salesmen (legacy pegII sales users/employees; workflow-runtime surface) ─
  // Read a salesman (a.k.a. employee / sales user) from the pegII serialized
  // endpoint. Backed by a by-id read over the tunnel (list is a stub today),
  // exactly like ReadOrder (see handlers/pegii-runtime.ts).
  ReadSalesman: { id: 'ReadSalesman', resourceType: 'Salesman', permission: 'salesman:read' },
  // ── Tasks (operational work items; workflow-runtime surface, pegII-bound) ─
  // Read/close of an order's tasks (date confirmation, survey scheduling, …)
  // from a running workflow. Backed by a stub today; bridges to the pegII API
  // like the retired longhaul surface (see handlers/pegii-runtime.ts).
  ReadTask: { id: 'ReadTask', resourceType: 'Task', permission: 'task:read' },
  CloseTask: { id: 'CloseTask', resourceType: 'Task', permission: 'task:close' },
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
  // ── Outbound delivery (workflow POSTs a mapped body to a partner endpoint) ─
  // The mutating counterpart to the (open, read-only) map-to-external transform:
  // a running workflow hands the platform the external body and the platform
  // performs the POST server-side, so the send flows through the platform (and
  // is captured, not performed, under dry-run) instead of a raw httpx call the
  // runtime can neither see nor stop. Granted to workflow_runtime.
  DeliverToExternal: {
    id: 'DeliverToExternal',
    resourceType: 'IntegrationConfig',
    permission: 'integration:deliver',
  },
  // ── Outbound authenticated call (generic method+path caller, OAuth server-side) ─
  // The read/arbitrary-method counterpart to DeliverToExternal's fixed JSON POST:
  // a workflow names a method + path and the platform performs the call
  // server-side using the integration's configured BASE_URL + (for OAuth2
  // partners) a client-credentials token it mints/caches/re-mints. Unlike the
  // open map-to-external transform, this makes real authenticated outbound calls
  // with tenant credentials, so it stays persona-scoped. Granted to workflow_runtime.
  CallExternal: {
    id: 'CallExternal',
    resourceType: 'IntegrationConfig',
    permission: 'integration:call',
  },
  // ── Inbound ingress (provision/rotate the bearer a partner POSTs with) ────
  // Management surface for the per-integration ingress credential (sdk-feedback
  // 0021). Granted to workflow_developer (the CLI persona) + tenant_admin. The
  // inbound endpoint ITSELF is pre-tenant and token-authenticated, not Cedar.
  ManageIngress: {
    id: 'ManageIngress',
    resourceType: 'IntegrationConfig',
    permission: 'ingress:manage',
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
  // ── Workflow blobs (opaque byte storage for document transfer) ────────────
  // A workflow stages/lands binary files (e.g. an ADE shipment document) in a
  // tenant-scoped blob via presigned S3 URLs. WriteBlob gates put/upload;
  // ReadBlob gates get/download-url. Both granted to workflow_runtime.
  ReadBlob: {
    id: 'ReadBlob',
    resourceType: 'Blob',
    permission: 'blob:read',
  },
  WriteBlob: {
    id: 'WriteBlob',
    resourceType: 'Blob',
    permission: 'blob:write',
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
