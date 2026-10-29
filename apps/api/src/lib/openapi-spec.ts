// ---------------------------------------------------------------------------
// OpenAPI 3.1 spec — served as a static JSON document.
//
// The spec is hand-authored here to avoid a heavy code-generation dependency.
// It documents the public surface area incrementally; start with /health and
// the core /api/v1/customers resource and expand with each new handler.
// ---------------------------------------------------------------------------

/** Compact builder for a simple `vnd_`-authenticated GET path (path + query
 *  params, one 200). Keeps the many operational read routes DRY; richer routes
 *  stay hand-authored below. */
function apiKeyGet(
  operationId: string,
  summary: string,
  opts: {
    tags?: string[]
    path?: string[]
    query?: Array<{ name: string; description?: string }>
    responseDescription?: string
  } = {},
): { get: Record<string, unknown> } {
  const parameters = [
    ...(opts.path ?? []).map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })),
    ...(opts.query ?? []).map((q) => ({
      name: q.name,
      in: 'query',
      required: false,
      schema: { type: 'string' },
      ...(q.description ? { description: q.description } : {}),
    })),
  ]
  return {
    get: {
      operationId,
      summary,
      tags: opts.tags ?? ['Runtime'],
      security: [{ ApiKeyAuth: [] }],
      ...(parameters.length ? { parameters } : {}),
      responses: { '200': { description: opts.responseDescription ?? 'OK' } },
    },
  }
}

/** The SDK's task row (handlers/pegii-runtime.ts toTaskResponse). */
const TASK_SHAPE =
  '{id, orderId, taskType, title, description, priority, dueDate, assigneeCode, status: "open"|"closed", reason, ' +
  'createdByApi, active, completedAt, completedBy, actualDate, createdAt, closedAt}'

// The operational `vnd_`-reachable GET surface (workflows / executions / triggers,
// pegII orders+tasks, secrets/config reads, projection cache + 0026 read-model,
// events, blobs, integration reads, legacy orders). Enforced complete by
// lib/openapi-spec.coverage.test.ts. `q` = the ?query= param the SDK's api_get can pass.
const OPERATIONAL_READ_PATHS: Record<string, { get: Record<string, unknown> }> = {
  '/api/v1/integrations/ringcentral/messages/{source}/{externalId}/attachments/{attachmentId}':
    apiKeyGet(
      'getRingCentralAttachment',
      'Fetch an MMS attachment from RingCentral by reference (ReadRingCentralAttachment). ' +
        'Pegasus stores only references (on-prem: dbo.inbound_message_attachments); the file is ' +
        "fetched through the tenant's RingCentral connection and never stored. source must be V1_STORE. " +
        'Errors: 400 UNSUPPORTED_SOURCE/INVALID_ID/UNSUPPORTED_FORMAT, 404 NO_RINGCENTRAL_CONNECTION/' +
        'ATTACHMENT_NOT_FOUND, 502 ATTACHMENT_TOO_LARGE/UPSTREAM_ERROR, 503 RATE_LIMITED (Retry-After).',
      {
        tags: ['Integrations'],
        path: ['source', 'externalId', 'attachmentId'],
        query: [
          {
            name: 'format',
            description:
              "Omit for a JSON envelope {data:{contentType,sizeBytes,contentBase64,…}}; 'raw' returns the bytes.",
          },
        ],
        responseDescription:
          '{data: {source, externalId, attachmentId, contentType, sizeBytes, contentBase64}} — or the raw bytes with ?format=raw',
      },
    ),
  '/api/v1/workflows': apiKeyGet(
    'listWorkflows',
    'List automations visible to the tenant (∪ GLOBAL); retired ones only with ?includeRetired=true',
    {
      tags: ['Workflows'],
      responseDescription: '{data: WorkflowResponse[]} (each carries status: ACTIVE | RETIRED)',
    },
  ),
  '/api/v1/workflows/requirements-summary': apiKeyGet(
    'getWorkflowRequirementsSummary',
    "For each visible automation, its manifest-declared secret/config keys tagged present/missing against the tenant's store (presence only, no values) (ReadWorkflow)",
    {
      tags: ['Workflows'],
      responseDescription:
        '{data: {workflows: [{workflowId, name, version, visibility, current, requirements: [{kind, key, group, description, present}], missingCount}], totalMissing: number}}. Every published version is its own row. current is true for the newest version (semver) of each (owner, name) and for any older version an enabled trigger of this tenant still runs; totalMissing counts current rows only, so keys a superseded version declared are not reported as still needed. SDK: requirements_summary; CLI: requirements [--all-versions].',
    },
  ),
  '/api/v1/workflows/{id}': apiKeyGet('getWorkflow', 'Get an automation by id', {
    tags: ['Workflows'],
    path: ['id'],
  }),
  '/api/v1/workflows/{id}/download-url': apiKeyGet(
    'getWorkflowDownloadUrl',
    'Presigned URL for an automation artifact (ReadWorkflow)',
    { tags: ['Workflows'], path: ['id'] },
  ),
  '/api/v1/workflows/{id}/triggers': apiKeyGet(
    'listTriggers',
    "List an automation's SCHEDULE + EVENT triggers (ReadWorkflow)",
    { tags: ['Workflows'], path: ['id'] },
  ),
  '/api/v1/workflows/{id}/executions': apiKeyGet(
    'listExecutions',
    "List an automation's executions, newest first (ReadWorkflow)",
    {
      tags: ['Workflows'],
      path: ['id'],
      query: [
        { name: 'limit', description: 'page size' },
        { name: 'before', description: 'paging cursor (an execution id)' },
      ],
    },
  ),
  '/api/v1/workflows/{id}/executions/{executionId}': apiKeyGet(
    'getExecution',
    'Get one execution (ReadWorkflow)',
    { tags: ['Workflows'], path: ['id', 'executionId'] },
  ),
  '/api/v1/workflows/{id}/executions/{executionId}/history': apiKeyGet(
    'getExecutionHistory',
    "Get an execution's Temporal event-history timeline (ReadWorkflow)",
    { tags: ['Workflows'], path: ['id', 'executionId'] },
  ),
  '/api/v1/pegii/orders': {
    get: {
      ...apiKeyGet('listPegiiOrders', 'DEPRECATED — always [] (ReadOrder)', {
        tags: ['pegII'],
        responseDescription:
          '{data: [], meta: {count: 0, deprecated}} with Deprecation + Link headers. pegII has no ' +
          'snapshot collection to list; select orders with GET /api/v1/pegii/orders/search.',
      }).get,
      deprecated: true,
    },
  },
  '/api/v1/pegii/orders/search': {
    get: {
      operationId: 'searchPegiiOrders',
      summary: 'Search pegII orders by a date range, read LIVE from sales (ReadOrder)',
      description:
        "Orders whose dateField falls in [from, to], read live from the site's sales table — not the serialized " +
        'snapshot GET /orders/{orderId} returns, which DB triggers and direct sales updates leave stale (e.g. a delivery ' +
        'actual entered by a trigger). Each item carries the eligibility fields a scheduled workflow needs: ' +
        'pack/load/delivery as {planned, earliest, latest, actual}, sitIn/sitOut {planned, actual}, planSit, actSitOut, ' +
        'coordinatorCode/Name, nationalAccountCode/Name, reloCompanyCode/Name, moveType (import_export) and moveTypeLegacy, ' +
        "shipperFirstName, shipperCellPhone, shipper/consignee zip + state, and texting: the desktop's own shipper-texting " +
        'verdict {status: Allowed | NotApprovedOnOrder | BlockedByAccount, orderAllows, accountBlocks, parentAccountBlocks}. ' +
        'Dates are YYYY-MM-DD. Keyset-paged on order number: pass meta.nextCursor back as cursor; null means the last page. ' +
        "503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.orders.search.v1.",
      tags: ['pegII'],
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        {
          name: 'dateField',
          in: 'query',
          required: true,
          schema: {
            type: 'string',
            enum: ['plan_pack', 'plan_load', 'del_actual', 'pack_date', 'load_date'],
          },
          description:
            "plan_pack / plan_load are the desktop KeyDate 'Latest' for pack/load; pack_date / load_date its 'Planned'; " +
            'del_actual the actual delivery date.',
        },
        {
          name: 'from',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'date' },
          description: 'Inclusive start, YYYY-MM-DD.',
        },
        {
          name: 'to',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'date' },
          description: 'Inclusive end, YYYY-MM-DD; at most 366 days after from.',
        },
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', default: 'A' },
          description: "One shipment-status letter (default A), or '*' for every status.",
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
          description: 'meta.nextCursor from the previous page.',
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        },
      ],
      responses: {
        '200': {
          description: '{data: [order search item], meta: {count, nextCursor: int | null}}',
        },
        '400': { description: 'VALIDATION_ERROR naming the bad parameter' },
        '403': { description: 'Missing ReadOrder' },
        '502': { description: 'PEGII_SOURCE_UNREACHABLE / PEGII_SOURCE_BAD_RESPONSE' },
        '503': { description: 'PEGII_CAPABILITY_MISSING / PEGII_SOURCE_UNAVAILABLE' },
      },
    },
  },
  '/api/v1/pegii/orders/{orderId}': apiKeyGet('getPegiiOrder', 'Get a pegII order (ReadOrder)', {
    tags: ['pegII'],
    path: ['orderId'],
    query: [
      {
        name: 'shape',
        description:
          "Set to 'native' to return the raw serialized pegII payload " +
          '({Id, Survey, InvolvedParties, KeyMoveDates, …}) instead of the ' +
          'projected order row — the shape a partner posts to the ingress, for ' +
          'dry-running a published integration via map_from_external.',
      },
    ],
  }),
  '/api/v1/pegii/salesmen': apiKeyGet('listPegiiSalesmen', 'List pegII salesmen (ReadSalesman)', {
    tags: ['pegII'],
    query: [{ name: 'active', description: 'filter by active state: true | false (omit for all)' }],
    responseDescription:
      "Every salesman in the default company's directory, read live from the site (all pages). " +
      "503 PEGII_CAPABILITY_MISSING when the site's pegII API build predates pegii.salesmen.list.v1.",
  }),
  '/api/v1/pegii/salesmen/{salesmanId}': apiKeyGet(
    'getPegiiSalesman',
    'Get a pegII salesman (ReadSalesman)',
    { tags: ['pegII'], path: ['salesmanId'] },
  ),
  '/api/v1/pegii/memo-types': apiKeyGet(
    'listPegiiMemoTypes',
    "List this site's order-memo types (ReadOrder)",
    {
      tags: ['pegII'],
      responseDescription:
        '{data: [{code, label}], meta: {company, count}}. The codes (1-7) are the same everywhere; the labels are what this ' +
        "company's MoveManager shows (on NW, 4 is Customer Service and 5 Claims; on QMM, 4 is General). company is null when the site can't tell, and the labels are then generic. " +
        "503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.memos.v1.",
    },
  ),
  '/api/v1/pegii/tasks': apiKeyGet(
    'listPegiiTasks',
    "List pegII tasks (ReadTask): an order's tasks, or one type across orders",
    {
      tags: ['pegII'],
      query: [
        {
          name: 'orderId',
          description:
            "Every task on this order (digits) — MoveManager's own and the cloud's — in one response",
        },
        {
          name: 'taskType',
          description:
            'Without orderId: cloud-created tasks of this type across orders (keyset-paged). With orderId: a filter. One of orderId/taskType is required',
        },
        { name: 'status', description: 'open | closed' },
        { name: 'dueBefore', description: 'YYYY-MM-DD; due strictly before' },
        {
          name: 'cursor',
          description: 'meta.nextCursor from the previous page (taskType search only)',
        },
        { name: 'limit', description: '1-500, default 100 (taskType search only)' },
      ],
      responseDescription:
        `{data: [${TASK_SHAPE}], meta: {count, nextCursor}}. ` +
        'Ids are the pegII task id, one per task. A desktop task reports its legacy code as taskType and has no priority; ' +
        'createdAt is set only for a task the cloud created, closedAt only for a close made through the API, completedAt is the site-local completion time. ' +
        "400 when neither orderId nor taskType is given; 404 ORDER_NOT_FOUND; an order with no tasks is []. 503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.tasks.v1.",
    },
  ),
  '/api/v1/pegii/tasks/{taskId}': apiKeyGet('getPegiiTask', 'Get a pegII task (ReadTask)', {
    tags: ['pegII'],
    path: ['taskId'],
    responseDescription:
      '{data: task} (same shape as listPegiiTasks rows); 404 NOT_FOUND if unknown',
  }),
  '/api/v1/orders': apiKeyGet('listOrders', 'List orders — legacy M2M order surface (ReadOrder)', {
    tags: ['Orders'],
  }),
  '/api/v1/orders/{orderId}': apiKeyGet('getOrder', 'Get an order — legacy M2M (ReadOrder)', {
    tags: ['Orders'],
    path: ['orderId'],
  }),
  '/api/v1/workflow-secrets-configs/secrets': apiKeyGet(
    'listSecrets',
    'List secret keys (no values) (ManageWorkflowSecrets)',
    { tags: ['Secrets & Config'], query: [{ name: 'group' }] },
  ),
  '/api/v1/workflow-secrets-configs/configs': apiKeyGet(
    'listConfigs',
    'List config key/values (ManageWorkflowConfigs)',
    { tags: ['Secrets & Config'], query: [{ name: 'group' }] },
  ),
  '/api/v1/workflow-secrets-configs/runtime/secrets/{key}': apiKeyGet(
    'getSecret',
    'Read a secret value at runtime (ReadWorkflowSecret)',
    { tags: ['Secrets & Config'], path: ['key'], query: [{ name: 'group' }] },
  ),
  '/api/v1/workflow-secrets-configs/runtime/configs/{key}': apiKeyGet(
    'getConfig',
    'Read a config value at runtime (ReadWorkflowConfig)',
    { tags: ['Secrets & Config'], path: ['key'], query: [{ name: 'group' }] },
  ),
  '/api/v1/integration-projections/runtime/{integrationId}/{entityType}': apiKeyGet(
    'listRuntimeProjections',
    'List cached projections for an entity type (ReadIntegrationProjection)',
    { tags: ['Projections'], path: ['integrationId', 'entityType'] },
  ),
  '/api/v1/integration-projections/runtime/{integrationId}/{entityType}/{entityKey}': apiKeyGet(
    'getRuntimeProjection',
    'Read one cached projection (ReadIntegrationProjection)',
    { tags: ['Projections'], path: ['integrationId', 'entityType', 'entityKey'] },
  ),
  '/api/v1/integration-projections/runtime/{integrationId}/{entityType}/by-local/{localEntityType}/{localEntityId}':
    apiKeyGet(
      'getRuntimeProjectionByLocalEntity',
      'Resolve a Pegasus entity to the partner key its cached state is stored under, and return that state with it. 404 when the entity has no correlation; a 200 with a null projection means the binding outlived its cache entry, so fetch rather than treating the entity as unknown (ReadIntegrationProjection)',
      {
        tags: ['Projections'],
        path: ['integrationId', 'entityType', 'localEntityType', 'localEntityId'],
      },
    ),
  '/api/v1/integrations/{integrationId}/projections/{entityType}': apiKeyGet(
    'queryProjections',
    'Read-model: filtered + keyset-paged projections for an entity type (ReadIntegrationProjection)',
    {
      tags: ['Projections'],
      path: ['integrationId', 'entityType'],
      query: [
        { name: 'status', description: 'filter by projected external status' },
        { name: 'updatedSince', description: 'ISO-8601; only records updated at/after' },
        { name: 'limit', description: 'page size (default 50)' },
        { name: 'cursor', description: 'keyset cursor — the nextCursor of a prior page' },
      ],
      responseDescription: '{data, nextCursor}',
    },
  ),
  '/api/v1/integrations/{integrationId}/projections/{entityType}/{entityKey}': apiKeyGet(
    'getProjectionRecord',
    'Read-model: one projection record (ReadIntegrationProjection)',
    { tags: ['Projections'], path: ['integrationId', 'entityType', 'entityKey'] },
  ),
  '/api/v1/integrations/{integrationId}/config/versions': apiKeyGet(
    'listConfigVersions',
    'Integration-config version history, newest first (ReadIntegrationConfig)',
    { tags: ['Integrations'], path: ['integrationId'] },
  ),
  '/api/v1/integrations/requirements-summary': apiKeyGet(
    'getIntegrationRequirementsSummary',
    "For each integration, its declared secret/config keys tagged present/missing against the tenant's store (presence only, no values) (ReadIntegrationConfig)",
    {
      tags: ['Integrations'],
      responseDescription: '{data: {integrations: [...], totalMissing: number}}',
    },
  ),
  '/api/v1/events/{eventType}': apiKeyGet(
    'listPendingEvents',
    'Poll the pending inbound events of a type (ReadEvent)',
    { tags: ['Events'], path: ['eventType'] },
  ),
  '/api/v1/event-types': apiKeyGet('listEventTypes', 'List the tenant-defined event types', {
    tags: ['Events'],
  }),
  '/api/v1/event-types/{name}': apiKeyGet('getEventType', 'Get a tenant event type by name', {
    tags: ['Events'],
    path: ['name'],
  }),
  '/api/v1/blobs/{blobId}/download-url': apiKeyGet(
    'getBlobDownloadUrl',
    'Presigned download URL for a blob (ReadBlob)',
    { tags: ['Blobs'], path: ['blobId'] },
  ),
  '/api/v1/feedback-forms': apiKeyGet(
    'listFeedbackForms',
    'List the tenant’s active (latest published) feedback forms',
    { tags: ['Feedback'], responseDescription: '{data: FeedbackFormSummary[]}' },
  ),
  '/api/v1/feedback-forms/{formKey}/versions': apiKeyGet(
    'listFeedbackFormVersions',
    'Version history for a feedback form key, newest first',
    { tags: ['Feedback'], path: ['formKey'] },
  ),
  '/api/v1/feedback-requests/{id}': apiKeyGet(
    'getFeedbackRequest',
    'Status of a minted feedback request (poll for the response)',
    { tags: ['Feedback'], path: ['id'], responseDescription: '{data: FeedbackRequestStatus}' },
  ),
}

// ── Labor (Cognito users only; see handlers/labor.ts) ────────────────────────
// A driver's private book of cash-labor crews, plus the tenant's company list.
// Every crew route answers 404 for a crew that is in neither the caller's book
// nor their company list — one of those links is the access.

const LABOR_PHONE_PARAM = {
  name: 'phone',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description:
    "The crew's phone number, URL-encoded. Any spelling is accepted (`+14045551212`, `(404) 555-1212`); it is normalised to E.164.",
}

const LABOR_ERRORS = {
  '400': { $ref: '#/components/responses/ValidationError' },
  '404': {
    description: 'Crew (or packer) not in your list',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
}

/** One labor operation: a JSON body (optional) and a `{data}` response. */
function laborOp(
  operationId: string,
  summary: string,
  opts: {
    description?: string
    phone?: boolean
    packerId?: boolean
    /** Integer path params (legacy order / activity ids). */
    intParams?: Array<{ name: string; description: string }>
    query?: Array<{ name: string; description: string }>
    body?: Record<string, unknown>
    data?: Record<string, unknown>
    status?: '200' | '201' | '204'
    extraResponses?: Record<string, unknown>
  } = {},
): Record<string, unknown> {
  const status = opts.status ?? '200'
  return {
    operationId,
    summary,
    tags: ['Labor'],
    ...(opts.description ? { description: opts.description } : {}),
    parameters: [
      ...(opts.phone ? [LABOR_PHONE_PARAM] : []),
      ...(opts.packerId
        ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]
        : []),
      ...(opts.intParams ?? []).map((p) => ({
        name: p.name,
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 },
        description: p.description,
      })),
      ...(opts.query ?? []).map((q) => ({
        name: q.name,
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: q.description,
      })),
    ],
    ...(opts.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: opts.body } },
          },
        }
      : {}),
    responses: {
      [status]:
        status === '204'
          ? { description: 'Done' }
          : {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: opts.data ?? { type: 'object' } },
                  },
                },
              },
            },
      ...LABOR_ERRORS,
      ...(opts.extraResponses ?? {}),
    },
  }
}

const LABOR_CREW = { $ref: '#/components/schemas/LaborCrew' }
const LABOR_CREW_DETAIL = { $ref: '#/components/schemas/LaborCrewDetail' }
const LABOR_PACKER = { $ref: '#/components/schemas/LaborPacker' }
const LABOR_ACTIVITY = { $ref: '#/components/schemas/LaborActivity' }
const LABOR_CREW_MEMBER = { $ref: '#/components/schemas/LaborCrewMember' }

const LABOR_ACTIVITY_ERRORS = {
  '403': {
    description: 'DRIVER_NOT_MAPPED, or NOT_YOUR_ACTIVITY on a write',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  '503': {
    description: 'LEGACY_UNAVAILABLE — the order database is not configured or failed',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
}

const LABOR_PACKER_BODY = {
  type: 'object',
  required: ['firstName', 'lastName'],
  description:
    'First and last name plus at least one of email, cidNumber or phone. cidIssuedOn (YYYY-MM-DD, not in the future) is required with a cidNumber.',
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: ['string', 'null'] },
    cidNumber: { type: ['string', 'null'], description: 'Candidate ID (certification number)' },
    cidIssuedOn: { type: ['string', 'null'], format: 'date' },
    phone: { type: ['string', 'null'] },
  },
}

const LABOR_DUPLICATE = {
  '409': {
    description:
      'PACKER_DUPLICATE — the crew already has a packer with that last name + CID number or last name + email',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
}

const LABOR_PATHS: Record<string, Record<string, unknown>> = {
  '/api/v1/labor/crews': {
    get: laborOp('listLaborCrews', 'My crews, A–Z or nearest first', {
      description:
        'No q: A–Z. A US ZIP, a Canadian postal code / FSA, or "City, ST": every crew, nearest first on its closest service area (`distanceMiles`, null = no geocoded area; `meta.location` is the point used, `meta.locationNotFound` when the place is unknown). A state/province code: crews serving it, A–Z. Other text: crews whose name, nickname or phone matches — else, if the text is a city name, nearest first from it.',
      query: [{ name: 'q', description: 'Search text (see description)' }],
      data: { type: 'array', items: LABOR_CREW },
    }),
    post: laborOp('addLaborCrew', 'Add a crew to my list', {
      description:
        'Idempotent. A number already added by another driver links you to their crew (its shared name stands; yours becomes your nickname when it differs). `meta.outcome`: added | linkedExisting | alreadyInList. Rate-limited to 100 new crews per user per 24h (429 LINK_RATE_LIMITED).',
      body: {
        type: 'object',
        required: ['phone', 'name'],
        properties: {
          phone: { type: 'string' },
          name: { type: 'string' },
          email: { type: ['string', 'null'] },
          nickname: { type: ['string', 'null'] },
        },
      },
      data: LABOR_CREW_DETAIL,
      status: '201',
      extraResponses: {
        '429': {
          description: 'LINK_RATE_LIMITED',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
    }),
  },
  '/api/v1/labor/company/crews': {
    get: laborOp('listCompanyLaborCrews', "My company's crew list, A–Z or nearest first", {
      description: 'The tenant-wide company list, with the same search as GET /labor/crews.',
      query: [{ name: 'q', description: 'Search text (see GET /labor/crews)' }],
      data: { type: 'array', items: LABOR_CREW },
    }),
    post: laborOp('addCompanyLaborCrew', 'Put a crew on the company list', {
      description:
        'Idempotent. A crew in your own list goes on as-is (`meta.outcome`: addedFromMyList). Any other number needs an Operations role and a name, like POST /labor/crews (added | linkedExisting — the shared name stands; yours becomes the company nickname when it differs) and spends your add budget (429 LINK_RATE_LIMITED). A non-Operations caller adding a crew not in their list gets 422 CREW_NOT_IN_YOUR_LIST. alreadyInList answers 200.',
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone: { type: 'string' },
          name: { type: 'string', description: 'Required unless the crew is in your own list' },
          email: { type: ['string', 'null'] },
          nickname: { type: ['string', 'null'], description: 'Company display name' },
        },
      },
      data: LABOR_CREW_DETAIL,
      status: '201',
      extraResponses: {
        '422': {
          description: 'CREW_NOT_IN_YOUR_LIST',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        '429': {
          description: 'LINK_RATE_LIMITED',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
    }),
  },
  '/api/v1/labor/company/crews/{phone}': {
    patch: laborOp(
      'updateCompanyLaborCrew',
      "Edit a company crew's shared name/email or company nickname",
      {
        phone: true,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Shared with every linked driver' },
            email: { type: ['string', 'null'], description: 'Shared' },
            nickname: {
              type: ['string', 'null'],
              description: 'Company display name; null clears',
            },
          },
        },
        data: LABOR_CREW_DETAIL,
      },
    ),
    delete: laborOp('removeCompanyLaborCrew', 'Remove a crew from the company list', {
      description:
        'Operations roles only (403 OPERATIONS_ONLY). The crew, every driver’s own link to it and past activity labor all stay.',
      phone: true,
      status: '204',
      extraResponses: {
        '403': {
          description: 'OPERATIONS_ONLY',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
    }),
  },
  '/api/v1/labor/crews/import': {
    post: laborOp('importLaborCrews', 'Add many crews (phone-contacts import)', {
      description:
        'Up to 200 rows. One result per row, in order — `outcome`: added | linkedExisting | alreadyInList | invalid (with code/error) | rateLimited. A bad row never fails the batch.',
      body: {
        type: 'object',
        required: ['crews'],
        properties: {
          crews: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              required: ['phone', 'name'],
              properties: {
                phone: { type: 'string' },
                name: { type: 'string' },
                email: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
      data: {
        type: 'array',
        items: {
          type: 'object',
          required: ['phone', 'outcome'],
          properties: {
            phone: { type: 'string' },
            outcome: {
              type: 'string',
              enum: ['added', 'linkedExisting', 'alreadyInList', 'invalid', 'rateLimited'],
            },
            code: { type: 'string' },
            error: { type: 'string' },
          },
        },
      },
    }),
  },
  '/api/v1/labor/crews/{phone}': {
    get: laborOp('getLaborCrew', 'A crew with its packers', {
      phone: true,
      data: LABOR_CREW_DETAIL,
    }),
    patch: laborOp('updateLaborCrew', "Edit a crew's shared name/email or my nickname", {
      phone: true,
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Shared with every linked driver' },
          email: { type: ['string', 'null'], description: 'Shared' },
          nickname: { type: ['string', 'null'], description: 'Private; null clears' },
        },
      },
      data: LABOR_CREW_DETAIL,
    }),
    delete: laborOp('removeLaborCrew', 'Remove a crew from MY list (and my rating)', {
      description: 'The crew itself stays for every other driver who has it.',
      phone: true,
      status: '204',
    }),
  },
  '/api/v1/labor/crews/{phone}/service-areas': {
    put: laborOp('setLaborCrewServiceAreas', "Replace a crew's (shared) service areas", {
      description:
        'US states and Canadian provinces; at most 50, de-duplicated. A city found in the geo reference data is geocoded for distance search; one that is not is kept with `geocoded: false`.',
      phone: true,
      body: {
        type: 'object',
        required: ['serviceAreas'],
        properties: {
          serviceAreas: {
            type: 'array',
            items: {
              type: 'object',
              required: ['city', 'region'],
              properties: {
                city: { type: 'string' },
                region: { type: 'string', description: 'Two-letter state/province code' },
              },
            },
          },
        },
      },
      data: LABOR_CREW_DETAIL,
    }),
  },
  '/api/v1/labor/crews/{phone}/packers': {
    post: laborOp('addLaborPacker', 'Add a packer to a crew', {
      phone: true,
      body: LABOR_PACKER_BODY,
      data: LABOR_PACKER,
      status: '201',
      extraResponses: LABOR_DUPLICATE,
    }),
  },
  '/api/v1/labor/crews/{phone}/packers/{id}': {
    patch: laborOp('updateLaborPacker', 'Edit a packer (omitted fields keep their value)', {
      phone: true,
      packerId: true,
      body: { ...LABOR_PACKER_BODY, required: [] },
      data: LABOR_PACKER,
      extraResponses: LABOR_DUPLICATE,
    }),
    delete: laborOp('deleteLaborPacker', 'Delete a packer', {
      phone: true,
      packerId: true,
      status: '204',
    }),
  },
  '/api/v1/labor/crews/{phone}/rating': {
    put: laborOp('rateLaborCrew', 'Set my private 1–5 star rating and comment', {
      phone: true,
      body: {
        type: 'object',
        required: ['stars'],
        properties: {
          stars: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
      data: LABOR_CREW_DETAIL,
    }),
    delete: laborOp('clearLaborCrewRating', 'Clear my rating', {
      phone: true,
      data: LABOR_CREW_DETAIL,
    }),
  },
  '/api/v1/labor/my-crew': {
    get: laborOp('listMyLaborCrew', 'My Crew — my own packers, A–Z', {
      description:
        'Private to the caller: no shared crew stands behind them and nobody else reads them. Members flagged `everyJob` are added to my PACK/LOAD/UNPK/RDEL/XDEL activities when dispatch accepts one of my trips (and the `trip.accepted` domain event fires).',
      data: { type: 'array', items: LABOR_CREW_MEMBER },
    }),
    post: laborOp('addMyLaborCrewMember', 'Add someone to My Crew', {
      description:
        'Same fields and rules as a packer, plus `everyJob`. Matching (last name + CID number or email) a member I removed brings that member back. At most 50 (422 MY_CREW_FULL).',
      body: {
        ...LABOR_PACKER_BODY,
        properties: { ...LABOR_PACKER_BODY.properties, everyJob: { type: 'boolean' } },
      },
      data: LABOR_CREW_MEMBER,
      status: '201',
      extraResponses: {
        '409': {
          description:
            'MEMBER_DUPLICATE — My Crew already has that last name + CID number or email',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
    }),
  },
  '/api/v1/labor/my-crew/{id}': {
    patch: laborOp('updateMyLaborCrewMember', 'Edit a My Crew member or flip Every job', {
      packerId: true,
      body: {
        ...LABOR_PACKER_BODY,
        required: [],
        properties: { ...LABOR_PACKER_BODY.properties, everyJob: { type: 'boolean' } },
      },
      data: LABOR_CREW_MEMBER,
    }),
    delete: laborOp('removeMyLaborCrewMember', 'Remove someone from My Crew', {
      description:
        'Soft: they leave My Crew and are never auto-assigned again, but stay on the activities they worked.',
      packerId: true,
      status: '204',
    }),
  },
  '/api/v1/labor/places': {
    get: laborOp('searchLaborPlaces', 'City typeahead (US + Canada) for service areas', {
      description:
        'Name-prefix match, most populous first, at most 20. "spring" or "spring, mo" to narrow to a state/province. Fewer than two letters answers [].',
      query: [{ name: 'q', description: 'City name prefix, optionally ", ST"' }],
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            region: { type: 'string' },
            country: { type: 'string', enum: ['US', 'CA'] },
          },
        },
      },
    }),
  },
  '/api/v1/labor/export': {
    get: laborOp('exportLaborCrews', 'My whole list, for a contacts export', {
      description:
        'Each crew with its packers, service areas and my rating — the input to the app’s .vcf / Google Contacts .csv export.',
      data: { type: 'array', items: { type: 'object' } },
    }),
  },
  '/api/v1/labor/orders/{orderNum}/activities': {
    get: laborOp('listLaborOrderActivities', "An order's activities with their crews and packers", {
      description:
        'A driver gets only the longhaul activities they own (the assigned driver, or the trip driver when unassigned), `editable: true`; an Operations role (tenant_admin, operations_admin, long_distance_dispatch, central_planning_dispatch) gets every activity on the order, editable only where its own driver mapping owns it. Each assigned crew lists ALL its packers, `selected` marking who worked the activity. `myCrew` is, on an activity I own, my whole My Crew (`selected` where they worked it) plus any other driver’s member who did; otherwise just the members who worked it. 403 DRIVER_NOT_MAPPED for any other login without a longhaul driver; 503 LEGACY_UNAVAILABLE when the order database cannot be read.',
      intParams: [{ name: 'orderNum', description: 'Legacy order number' }],
      data: { type: 'array', items: LABOR_ACTIVITY },
      extraResponses: LABOR_ACTIVITY_ERRORS,
    }),
  },
  '/api/v1/labor/activities/{activityId}': {
    put: laborOp('setLaborActivity', "Replace an activity's crews and selected packers", {
      description:
        "Only the activity's own driver may write. A crew newly added must be in the caller's list (422 CREW_NOT_IN_YOUR_LIST); one already assigned may stay after it is removed from the list. Every packer must be on its crew (422 PACKER_NOT_ON_CREW). At most 10 crews; an empty list clears the activity. `memberIds` replaces the activity's My Crew members: one newly ticked must be in the caller's My Crew (422 MEMBER_NOT_YOURS); one already on it may stay after removal. Omit `memberIds` to leave them unchanged. An actual date does not lock it.",
      intParams: [{ name: 'activityId', description: 'Legacy longhaul activity id' }],
      body: {
        type: 'object',
        required: ['crews'],
        properties: {
          crews: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              required: ['phone', 'packerIds'],
              properties: {
                phone: { type: 'string', description: 'Any spelling; normalised to E.164' },
                packerIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          memberIds: {
            type: 'array',
            maxItems: 50,
            items: { type: 'string' },
            description: 'My Crew member ids who worked it; omitted = unchanged',
          },
        },
      },
      data: LABOR_ACTIVITY,
      extraResponses: {
        ...LABOR_ACTIVITY_ERRORS,
        '409': {
          description: 'ACTIVITY_LABOR_CONFLICT — a concurrent save; reload and retry',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        '422': {
          description: 'CREW_NOT_IN_YOUR_LIST, PACKER_NOT_ON_CREW or MEMBER_NOT_YOURS',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
    }),
  },
}

export function getOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pegasus API',
      version: '1.0.0',
      description:
        'The SDK-facing (vnd_ / m2m) Pegasus API surface — the endpoints a PegasusClient key can call, including the operational read surface reachable via api_get. Cognito-only browser routes and worker-internal (broker-secret) endpoints are intentionally excluded.',
    },
    tags: [
      {
        name: 'Workflows',
        description:
          'Automations: short, sandboxed Python runs (up to 900 s each) started manually, by a domain event, or on a schedule. The product concept was renamed from "workflows" to "Automations"; the `/workflows` paths, operation ids, and Cedar action names (e.g. ReadWorkflow) keep their original names for compatibility. Long-running, event-driven Workflows are a separate, upcoming capability.',
      },
    ],
    paths: {
      ...OPERATIONAL_READ_PATHS,
      '/api/v1/email/check-recipients': {
        post: {
          operationId: 'checkEmailRecipients',
          summary: 'Would /email/send accept these recipients? No send, no record (SendEmail)',
          description:
            'Body { to (address or list), cc? }. Applies exactly the recipient rules /email/send does — the tenant’s allowed domains (Settings → App → Operations) and the 10-recipient cap — and returns a verdict without sending, recording or counting anything, so an automation can pick a recipient before composing instead of catching RECIPIENT_NOT_ALLOWED. Always 200 for a well-formed body. Side-effect free: the SDK runs it live under a dry run. Not metered. SDK: check_email_recipients.',
          tags: ['Email'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to'],
                  additionalProperties: false,
                  properties: {
                    to: {
                      oneOf: [
                        { type: 'string', format: 'email' },
                        { type: 'array', items: { type: 'string', format: 'email' }, minItems: 1 },
                      ],
                    },
                    cc: { type: 'array', items: { type: 'string', format: 'email' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                '{data: {ok, reason, disallowed}} — ok:true, reason:null when every recipient would be accepted; else reason is NOT_CONFIGURED (no allowed domains: email is off) | RECIPIENT_NOT_ALLOWED (disallowed lists the refused addresses) | TOO_MANY_RECIPIENTS',
            },
            '400': { description: 'VALIDATION_ERROR — malformed address or body' },
          },
        },
      },
      '/api/v1/email/send': {
        post: {
          operationId: 'sendEmail',
          summary:
            'Send an internal email through the tenant’s pegII API / SMTP account (SendEmail)',
          description:
            'Body { to (address or list), cc?, subject (single line, ≤300), body, bodyType? (text | html, default text), dedupKey? }. Recipients must be on the tenant’s allowed domains (Settings → App → Operations; unset ⇒ 409 EMAIL_RECIPIENTS_NOT_CONFIGURED, outside ⇒ 400 RECIPIENT_NOT_ALLOWED — ask first with POST /email/check-recipients); ≤10 recipients (400 TOO_MANY_RECIPIENTS); body ≤100 KB (413); a per-tenant daily limit (429 EMAIL_DAILY_LIMIT). With dedupKey a retry returns the first send (200, alreadySent:true); 409 EMAIL_SEND_IN_PROGRESS / EMAIL_SEND_IN_DOUBT / IDEMPOTENCY_KEY_REUSED as for /sms/send. The From address is the site’s configured default. 503 EMAIL_NOT_CONFIGURED when the site has no SMTP account, 503 PEGII_CAPABILITY_MISSING when its pegII API predates email or lacks auth, 502 EMAIL_SEND_FAILED when SMTP refuses.',
          tags: ['Email'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to', 'subject', 'body'],
                  additionalProperties: false,
                  properties: {
                    to: {
                      oneOf: [
                        { type: 'string', format: 'email' },
                        { type: 'array', items: { type: 'string', format: 'email' }, minItems: 1 },
                      ],
                    },
                    cc: { type: 'array', items: { type: 'string', format: 'email' } },
                    subject: { type: 'string', minLength: 1, maxLength: 300 },
                    body: { type: 'string', minLength: 1 },
                    bodyType: { type: 'string', enum: ['text', 'html'], default: 'text' },
                    dedupKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{data: {id, alreadySent: true}} — replay' },
            '202': {
              description: '{data: {id, alreadySent: false}} — handed to the site’s SMTP relay',
            },
            '400': {
              description: 'VALIDATION_ERROR | RECIPIENT_NOT_ALLOWED | TOO_MANY_RECIPIENTS',
            },
            '409': {
              description:
                'EMAIL_RECIPIENTS_NOT_CONFIGURED | EMAIL_SEND_IN_PROGRESS | EMAIL_SEND_IN_DOUBT | IDEMPOTENCY_KEY_REUSED',
            },
            '413': { description: 'BODY_TOO_LARGE' },
            '429': { description: 'EMAIL_DAILY_LIMIT' },
            '502': {
              description:
                'EMAIL_SEND_FAILED | PEGII_SOURCE_UNREACHABLE | PEGII_SOURCE_AUTH_FAILED',
            },
            '503': {
              description:
                'EMAIL_NOT_CONFIGURED | PEGII_CAPABILITY_MISSING | PEGII_AUTH_UNAVAILABLE',
            },
          },
        },
      },
      '/api/v1/sms/send': {
        post: {
          operationId: 'sendSms',
          summary: 'Send an SMS through the tenant’s RingCentral connection (SendSms)',
          description:
            'Body { to (E.164), body (1–1000 chars), dedupKey? }. Every send is refused with 409 SMS_OPTED_OUT when the recipient has opted out (a STOP keyword we captured, a provider opt-out rejection, or a recorded opt-out). With dedupKey, a retry returns the first send (200, alreadySent:true) instead of texting again; 409 SMS_SEND_IN_PROGRESS = the same key is mid-send, 409 SMS_SEND_IN_DOUBT = it started but its outcome is unknown and it will not be resent automatically, 409 IDEMPOTENCY_KEY_REUSED = the key was used for a different recipient or body.',
          tags: ['SMS'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to', 'body'],
                  properties: {
                    to: { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$' },
                    body: { type: 'string', minLength: 1, maxLength: 1000 },
                    dedupKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: '{data: {id, status, alreadySent: true}} — replay of an earlier send',
            },
            '202': {
              description: '{data: {id, status, alreadySent: false}} — accepted by RingCentral',
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': {
              description:
                'SMS_NOT_CONNECTED — the tenant has no active RingCentral connection (no SMS channel); an Automation can skip on it',
            },
            '409': {
              description:
                'SMS_OPTED_OUT | SMS_SEND_IN_PROGRESS | SMS_SEND_IN_DOUBT | IDEMPOTENCY_KEY_REUSED',
            },
            '429': { description: 'RingCentral rate limit; honour Retry-After' },
            '502': { description: 'UPSTREAM_ERROR — RingCentral error' },
            '503': { description: 'SERVICE_UNAVAILABLE — RingCentral disabled platform-wide' },
          },
        },
      },
      '/api/v1/sms/messages/{id}': {
        get: {
          operationId: 'getTextMessage',
          summary:
            'Read one captured SMS by the messageId an sms.received event carries (ReadTextMessage)',
          description:
            'Returns {data: {id, source, externalId, threadId, direction, fromNumber, toNumber, body, bodyPurged, createdAt, capturedAt}}. externalId is the RingCentral message id. The body is purged 72h after the message is forwarded on-prem (body null, bodyPurged true), so read it promptly. Read state and order/coordinator links are not held in the cloud.',
          tags: ['SMS'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { description: 'The message' },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/sms/messages/{id}/read': {
        post: {
          operationId: 'markTextMessageRead',
          summary: 'Mark a captured inbound text read at RingCentral (UpdateTextMessage)',
          description:
            'RingCentral owns read state; the legacy desktop mirrors it, so this is the write that clears the unread badge coordinators see. Idempotent: an already-read message returns alreadyRead:true. 409 UNSUPPORTED_SOURCE for thread-store messages; 409 NO_CONNECTION when the tenant has no active RingCentral connection; 404 when the id is unknown here or at RingCentral.',
          tags: ['SMS'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description:
                '{data: {id, readStatus: "Read", alreadyRead, mirroredToDesktop}}. After RingCentral accepts the read it is mirrored, best-effort, into the legacy desktop\'s own copy (pegII, pegii.text-messages.v1); mirroredToDesktop is false when that could not happen (no pegII site, an older site, the desktop has not archived the message yet, or an error). It never fails the call.',
            },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { description: 'UNSUPPORTED_SOURCE | NO_CONNECTION' },
            '429': { description: 'RingCentral rate limit; honour Retry-After' },
            '502': { description: 'UPSTREAM_ERROR' },
            '503': { description: 'SERVICE_UNAVAILABLE' },
          },
        },
      },
      '/api/v1/sms/messages/{id}/links': {
        get: {
          operationId: 'getTextMessageLinks',
          summary:
            "Which orders and employees a captured text's conversation is linked to, in the legacy desktop (ReadTextMessage)",
          description:
            'Returns {data: {id, externalId, conversationId, desktopReadStatus ("Read" | "Unread" | null), orderIds[], driverCodes[], employeeCodes[]}}, read live from the tenant\'s pegII site. ' +
            "orderIds are the conversation's Shipper links (order numbers); driverCodes its Driver links, raw (a driver is not resolved to an order); employeeCodes the MoveManager employees following it. " +
            'The desktop archives a message on its next sync pass, so a very new message answers nulls and empty lists, never 404. ' +
            "409 UNSUPPORTED_SOURCE for thread-store messages. 503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.text-messages.v1.",
          tags: ['SMS'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { description: 'The links' },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { description: 'UNSUPPORTED_SOURCE' },
            '502': { description: 'PEGII_SOURCE_UNREACHABLE / PEGII_SOURCE_BAD_RESPONSE' },
            '503': { description: 'PEGII_CAPABILITY_MISSING / PEGII_SOURCE_UNAVAILABLE' },
          },
        },
      },
      '/api/v1/sms/opt-outs/{phone}': {
        get: {
          operationId: 'getSmsOptOut',
          summary: 'Opt-out state for one number (ReadSmsOptOut)',
          description:
            'Returns {data: {phone, optedOut, source (KEYWORD | PROVIDER | MANUAL | null), keyword, updatedAt}}. A number with no record has never opted out. STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE and OPTOUT as the first word of an inbound text opt out; START or UNSTOP opt back in. Opt-outs are per tenant.',
          tags: ['SMS'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'phone',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$' },
            },
          ],
          responses: {
            '200': { description: 'The opt-out state' },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/sms/opt-outs': {
        post: {
          operationId: 'recordSmsOptOut',
          summary: 'Record an opt-out, or an opt-in with optedOut:false (ManageSmsOptOut)',
          description:
            'Body { phone (E.164), optedOut? (default true), source? (MANUAL | KEYWORD, default MANUAL) }. Takes effect now and overrides any earlier keyword. Idempotent.',
          tags: ['SMS'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['phone'],
                  additionalProperties: false,
                  properties: {
                    phone: { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$' },
                    optedOut: { type: 'boolean', default: true },
                    source: { type: 'string', enum: ['MANUAL', 'KEYWORD'], default: 'MANUAL' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'The resulting opt-out state' },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/usage/summary': {
        get: {
          operationId: 'getUsageSummary',
          summary: "The tenant's billable automated actions against its plan (ReadUsage)",
          description:
            'Billable actions in the plan term in effect (or, with no plan, the calendar year): pool, ' +
            'usedTermToDate, remaining, overageActions, a linear projectedAtTermEnd (an ESTIMATE), ' +
            'and byMonth / byAction / byWorkflow breakdowns. A billable action is a successful, ' +
            'first-time, outward-reaching mutation by an API client: SendSms, SendEmail, ' +
            'UpdateTextMessage (mark read), CloseTask, DeliverToExternal, and mutating ' +
            'CallExternal calls (not GET). Free: every read, workflow state, runs, dry runs, ' +
            'non-2xx responses, idempotent replays (a retry with the same dedupKey), and anything ' +
            'a human does in the web app. Cognito callers need tenant_admin.',
          tags: ['Usage'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'year',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 2020, maximum: 2100 },
              description: 'the term that started in this year (default: the term in effect today)',
            },
          ],
          responses: {
            '200': {
              description:
                '{data: {plan, termStart, termEnd, pool, usedTermToDate, remaining, overageActions, projectedAtTermEnd, asOf, byMonth[], byAction[], byWorkflow[]}}',
            },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/workflow-state/{namespace}': {
        get: {
          operationId: 'listWorkflowState',
          summary: 'List a workflow-state namespace, keyset-paged by key (ReadWorkflowState)',
          description:
            'Tenant-wide key/value state that running workflows keep for themselves (ledgers, claims, reservations). Compose hierarchical keys with ":" and narrow with `prefix`. Returns {data, nextCursor}; pass nextCursor back as `cursor` for the next page.',
          tags: ['Workflow State'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'namespace',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
            {
              name: 'prefix',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'only keys starting with this',
            },
            {
              name: 'updatedSince',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
              description: 'only rows written at/after this instant',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            },
            {
              name: 'cursor',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'the nextCursor of the previous page (exclusive)',
            },
          ],
          responses: {
            '200': { description: '{data: WorkflowState[], nextCursor: string | null}' },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/workflow-state/{namespace}/{key}': {
        get: {
          operationId: 'getWorkflowState',
          summary: 'Read one workflow-state row (ReadWorkflowState)',
          tags: ['Workflow State'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'namespace',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
            {
              name: 'key',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
          ],
          responses: {
            '200': {
              description:
                '{data: {namespace, key, state, version, updatedByUserId, createdAt, updatedAt}}',
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        put: {
          operationId: 'putWorkflowState',
          summary:
            'Write a workflow-state row: atomic claim, compare-and-set, or upsert (WriteWorkflowState)',
          description:
            'Body { state, ifAbsent?, expectedVersion? } (state ≤ 256 KB; the two flags are mutually exclusive). ifAbsent:true inserts only when the key is free — 201, or 409 STATE_EXISTS with data.current — and is the atomic claim that stops overlapping runs from both acting. expectedVersion:N writes only while the stored version is N — 200, or 409 STATE_VERSION_CONFLICT with data.current (null when the key is gone). With neither, an unconditional upsert: 201 created / 200 overwritten. Every write bumps `version`.',
          tags: ['Workflow State'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'namespace',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
            {
              name: 'key',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['state'],
                  additionalProperties: false,
                  properties: {
                    state: { description: 'any JSON value' },
                    ifAbsent: { type: 'boolean' },
                    expectedVersion: { type: 'integer', minimum: 1 },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: '{data, created: false} — overwritten / compare-and-set applied',
            },
            '201': { description: '{data, created: true} — created (or claimed)' },
            '400': { $ref: '#/components/responses/ValidationError' },
            '409': {
              description:
                'STATE_EXISTS or STATE_VERSION_CONFLICT; body.data.current is the stored row (or null)',
            },
            '413': { description: 'state exceeds 256 KB' },
          },
        },
        delete: {
          operationId: 'deleteWorkflowState',
          summary:
            'Delete a workflow-state row, optionally only at an expected version (WriteWorkflowState)',
          tags: ['Workflow State'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'namespace',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
            {
              name: 'key',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
            },
            {
              name: 'expectedVersion',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1 },
            },
          ],
          responses: {
            '204': { description: 'Deleted' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { description: 'STATE_VERSION_CONFLICT; body.data.current is the stored row' },
          },
        },
      },
      '/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Health check',
          description:
            'Returns the operational status of the API. Add ?deep=true to also probe the database.',
          parameters: [
            {
              name: 'deep',
              in: 'query',
              required: false,
              schema: { type: 'boolean' },
              description: 'If true, performs a database connectivity check.',
            },
          ],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'timestamp'],
                    properties: {
                      status: { type: 'string', enum: ['ok', 'degraded'] },
                      timestamp: { type: 'string', format: 'date-time' },
                      db: { type: 'string', enum: ['ok', 'error'] },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Service is degraded (database unreachable)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'db', 'timestamp'],
                    properties: {
                      status: { type: 'string', enum: ['degraded'] },
                      db: { type: 'string', enum: ['error'] },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/.well-known/jwks.json': {
        get: {
          operationId: 'getPegiiTokenJwks',
          summary: 'Public keys for cloud-issued pegII tokens',
          description:
            'The JSON Web Key Set on-prem pegII sites use to verify the short-lived ES256 tokens ' +
            'the platform sends on every bridge call (aud = pegii-site:<siteId>). Public by design; ' +
            'lists every active signing key, current first, so key rotation overlaps.',
          security: [],
          responses: {
            '200': {
              description: 'The key set',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['keys'],
                    properties: {
                      keys: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['kty', 'crv', 'x', 'y', 'kid', 'alg', 'use'],
                          properties: {
                            kty: { type: 'string', enum: ['EC'] },
                            crv: { type: 'string', enum: ['P-256'] },
                            x: { type: 'string' },
                            y: { type: 'string' },
                            kid: { type: 'string' },
                            alg: { type: 'string', enum: ['ES256'] },
                            use: { type: 'string', enum: ['sig'] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '503': { description: 'Signing keys are temporarily unavailable' },
          },
        },
      },
      '/api/v1/customers': {
        get: {
          operationId: 'listCustomers',
          summary: 'List customers',
          description: 'Returns a paginated list of customers for the current tenant.',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 0, default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Paginated customer list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } },
                      meta: {
                        type: 'object',
                        required: ['count', 'limit', 'offset'],
                        properties: {
                          count: { type: 'integer' },
                          limit: { type: 'integer' },
                          offset: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createCustomer',
          summary: 'Create a customer',
          description: 'Creates a new customer with an initial primary contact.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateCustomerBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Customer created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/Customer' },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/customers/{id}': {
        get: {
          operationId: 'getCustomer',
          summary: 'Get a customer',
          parameters: [{ $ref: '#/components/parameters/IdPath' }],
          responses: {
            '200': {
              description: 'Customer found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Customer' } },
                  },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        put: {
          operationId: 'updateCustomer',
          summary: 'Update a customer',
          parameters: [{ $ref: '#/components/parameters/IdPath' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateCustomerBody' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Customer updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Customer' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        delete: {
          operationId: 'deleteCustomer',
          summary: 'Delete a customer',
          parameters: [{ $ref: '#/components/parameters/IdPath' }],
          responses: {
            '204': { description: 'Customer deleted' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/customers/{id}/contacts': {
        post: {
          operationId: 'createContact',
          summary: 'Add a contact to a customer',
          parameters: [{ $ref: '#/components/parameters/IdPath' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContactBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Contact created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Contact' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/reporting/datasets': {
        get: {
          operationId: 'listReportingDatasets',
          summary: 'List the reporting dataset catalog',
          description:
            'Returns the datasets this caller may run, filtered by their existing grants. ' +
            'Each entry carries its column list and a JSON Schema for its params, so a client ' +
            'can build a valid /reporting/query request without out-of-band documentation. ' +
            'An empty list is a valid 200 — it means the caller holds the reporting permission ' +
            'but no dataset-level grants. Requires the ReadReportingDataset action, and the ' +
            'REPORTING_ENABLED feature flag (404 when off).',
          responses: {
            '200': {
              description: 'Dataset catalog',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'object',
                        required: ['datasets'],
                        properties: {
                          datasets: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/ReportingDataset' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '404': { description: 'Reporting is not enabled for this deployment' },
          },
        },
      },
      '/api/v1/reporting/query': {
        post: {
          operationId: 'runReportingQuery',
          summary: 'Run up to 12 reporting datasets in one request',
          description:
            'Batched by design: a dashboard render is ONE request, and all legacy-sourced ' +
            'datasets in it collapse into a single on-prem round trip. Results are returned ' +
            'in request order. A dataset that fails individually returns an `error` in its own ' +
            'slot rather than failing the batch, so one unavailable source cannot blank a ' +
            'dashboard. Authorization is two-layer: the caller needs ReadReportingDataset AND ' +
            'each requested dataset’s own action — if any dataset is not permitted the whole ' +
            'request is refused with 403.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['requests'],
                  properties: {
                    requests: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 12,
                      items: {
                        type: 'object',
                        required: ['datasetId'],
                        properties: {
                          datasetId: { type: 'string' },
                          params: {
                            type: 'object',
                            description:
                              'Validated against that dataset’s paramsSchema from GET /reporting/datasets.',
                            additionalProperties: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Results, in request order',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'object',
                        required: ['results'],
                        properties: {
                          results: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/ReportingResult' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { description: 'Reporting is not enabled for this deployment' },
          },
        },
      },
      '/api/v1/reporting/dashboards': {
        get: {
          operationId: 'listDashboards',
          summary: 'List dashboards visible to this tenant',
          description:
            'The tenant’s own published dashboards plus any the platform published GLOBAL. ' +
            'A tenant’s own dashboard SHADOWS a GLOBAL one of the same slug (it forked and ' +
            'customized it), so at most one entry per slug is returned. Requires ' +
            'ReadReportingDataset.',
          responses: {
            '200': {
              description: 'Visible dashboards',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'object',
                        required: ['dashboards'],
                        properties: {
                          dashboards: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/Dashboard' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '404': { description: 'Reporting is not enabled for this deployment' },
          },
        },
        post: {
          operationId: 'publishDashboard',
          summary: 'Publish a new immutable dashboard version',
          description:
            'Writes version max+1 for (tenant, slug) and supersedes the prior published ' +
            'version in one transaction. `visibility` is derived SERVER-side from the ' +
            'publishing tenant’s platform flag — a client cannot request GLOBAL. The ' +
            'definition is re-validated against the dataset registry: unknown dataset ids and ' +
            'bad widget params are rejected, and the caller must hold each referenced ' +
            'dataset’s own action. A dataset VERSION mismatch is returned as a `warnings` ' +
            'entry, not an error. Requires ManageDashboards.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['slug', 'title', 'definition'],
                  properties: {
                    slug: {
                      type: 'string',
                      description: 'Lowercase kebab-case. Stable identity across versions.',
                      example: 'operations-overview',
                    },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    definition: { $ref: '#/components/schemas/DashboardDocument' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Published',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Dashboard' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { description: 'Reporting is not enabled for this deployment' },
          },
        },
      },
      '/api/v1/reporting/dashboards/{slug}': {
        get: {
          operationId: 'getDashboard',
          summary: 'Resolve one dashboard by slug',
          description:
            'The tenant’s own published version wins; otherwise the GLOBAL one. Requires ' +
            'ReadReportingDataset.',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The resolved dashboard',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Dashboard' } },
                  },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        delete: {
          operationId: 'archiveDashboard',
          summary: 'Archive this tenant’s lineage for a slug',
          description:
            'Scoped to the caller’s tenant, so it can never withdraw a GLOBAL dashboard or ' +
            'another tenant’s. Archiving a fork means the GLOBAL original resolves again. ' +
            'Requires ManageDashboards.',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Archived' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/reporting/dashboards/{slug}/fork': {
        post: {
          operationId: 'forkDashboard',
          summary: 'Fork a GLOBAL dashboard to this tenant',
          description:
            'Copies the platform’s published document into a TENANT-owned version 1 of the ' +
            'same slug, recording provenance. The fork then shadows the original everywhere ' +
            'that slug resolves. 409 when the tenant already owns this slug. Requires ' +
            'ManageDashboards.',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '201': {
              description: 'Forked',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Dashboard' } },
                  },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { description: 'This tenant already has a dashboard with that slug' },
          },
        },
      },
      '/api/v1/me/preferences': {
        get: {
          operationId: 'getMyPreferences',
          summary: 'Read the calling user’s preferences',
          description:
            'Scoped to the caller, so no permission beyond authentication is required. ' +
            'Always returns a fully-hydrated object, even for a user who has never set one.',
          responses: {
            '200': {
              description: 'Preferences',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/UserPreferences' } },
                  },
                },
              },
            },
          },
        },
        patch: {
          operationId: 'updateMyPreferences',
          summary: 'Update the calling user’s preferences',
          description:
            'Shallow-merges per section, so a client that does not know about a section added ' +
            'later cannot wipe it. `defaultDashboardSlug` is deliberately NOT validated ' +
            'against existing dashboards: a slug that stops resolving falls back to the ' +
            'built-in at render time rather than erroring.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UserPreferences' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated preferences',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/UserPreferences' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '403': { description: 'This principal has no user profile (service account)' },
          },
        },
      },
      // ── Move chat (Cognito users only; see handlers/chat.ts) ─────────────────
      '/api/v1/chat/rooms/{entityType}/{entityId}': {
        get: {
          operationId: 'getChatRoom',
          summary: "A move's chat room and my membership",
          description:
            'Answers an empty room (id null) when nobody has posted yet. Employees read every room; driver-scoped logins only the moves they are assigned to.',
          parameters: [
            {
              name: 'entityType',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['shipment'] },
            },
            {
              name: 'entityId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
              description: 'The legacy order number.',
            },
          ],
          responses: {
            '200': {
              description: 'Room summary',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { type: 'object' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/v1/chat/rooms/{entityType}/{entityId}/messages': {
        get: {
          operationId: 'listChatMessages',
          summary: 'Messages in a room, oldest first',
          description:
            'Poll with `after` (a message id); scroll back with `before`. Without either, the newest `limit` messages.',
          parameters: [
            ...[
              {
                name: 'entityType',
                in: 'path',
                required: true,
                schema: { type: 'string', enum: ['shipment'] },
              },
              {
                name: 'entityId',
                in: 'path',
                required: true,
                schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
                description: 'The legacy order number.',
              },
            ],
            { name: 'after', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'before', in: 'query', required: false, schema: { type: 'string' } },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            '200': {
              description: 'Messages',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
        post: {
          operationId: 'postChatMessage',
          summary: 'Post a message',
          description:
            'Idempotent on `clientMessageId`: a resend returns the stored message with 200. The first post on an order creates its room. Mention someone with `@[Name](userId)`.',
          parameters: [
            {
              name: 'entityType',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['shipment'] },
            },
            {
              name: 'entityId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
              description: 'The legacy order number.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['clientMessageId', 'body'],
                  properties: {
                    clientMessageId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' },
                    body: { type: 'string', minLength: 1, maxLength: 4000 },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Posted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/ChatMessage' } },
                  },
                },
              },
            },
            '200': {
              description: 'Replay of an earlier send',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/ChatMessage' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': {
              description: 'clientMessageId already used in a different room',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/v1/chat/rooms/{entityType}/{entityId}/read': {
        post: {
          operationId: 'markChatRead',
          summary: 'Advance my read cursor',
          parameters: [
            {
              name: 'entityType',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['shipment'] },
            },
            {
              name: 'entityId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
              description: 'The legacy order number.',
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { at: { type: 'string', format: 'date-time' } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'New cursor',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { type: 'object' } },
                  },
                },
              },
            },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/v1/chat/rooms/{entityType}/{entityId}/membership': {
        put: {
          operationId: 'setChatMembership',
          summary: 'Follow, unfollow or mute a room',
          parameters: [
            {
              name: 'entityType',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['shipment'] },
            },
            {
              name: 'entityId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
              description: 'The legacy order number.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { following: { type: 'boolean' }, muted: { type: 'boolean' } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Membership',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { type: 'object' } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/chat/rooms/{entityType}/{entityId}/mentionable': {
        get: {
          operationId: 'listChatMentionable',
          summary: 'People who can be @mentioned in a room',
          parameters: [
            {
              name: 'entityType',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['shipment'] },
            },
            {
              name: 'entityId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
              description: 'The legacy order number.',
            },
          ],
          responses: {
            '200': {
              description: 'Employees and the move’s assigned drivers',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { type: 'array', items: { type: 'object' } } },
                  },
                },
              },
            },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/v1/chat/messages/{messageId}': {
        delete: {
          operationId: 'deleteChatMessage',
          summary: 'Delete one of your messages (tenant_admin: any)',
          parameters: [
            { name: 'messageId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Deleted (body is null)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/ChatMessage' } },
                  },
                },
              },
            },
            '403': {
              description:
                'Not assigned to this move (driver-scoped login), or not a signed-in user',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/chat/inbox': {
        get: {
          operationId: 'getChatInbox',
          summary: 'My conversations, newest activity first',
          description:
            '`all` (employees only) lists every room with a message; otherwise the rooms I follow, with unread and unread-mention counts.',
          parameters: [
            {
              name: 'filter',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['following', 'all'] },
            },
          ],
          responses: {
            '200': {
              description: 'Inbox',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { type: 'array', items: { type: 'object' } } },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/chat/summaries': {
        get: {
          operationId: 'getChatSummaries',
          summary: 'Header details for a batch of moves (shipper, origin → destination, dates)',
          description:
            'One legacy read for up to 100 ids. A driver-scoped caller gets only the moves they can read; others are absent from the result. 503 LEGACY_UNAVAILABLE when the legacy database cannot be reached.',
          parameters: [
            {
              name: 'entityType',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['shipment'] },
            },
            {
              name: 'ids',
              in: 'query',
              required: true,
              description: 'Comma-separated order numbers (at most 100)',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Summaries',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['orderNum'],
                          properties: {
                            orderNum: { type: 'integer' },
                            shipperName: { type: 'string', nullable: true },
                            origin: { type: 'string', nullable: true },
                            destination: { type: 'string', nullable: true },
                            packDate: { type: 'string', format: 'date', nullable: true },
                            loadDate: { type: 'string', format: 'date', nullable: true },
                            deliveryDate: { type: 'string', format: 'date', nullable: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      ...LABOR_PATHS,
      '/api/v1/local-drivers': {
        get: {
          operationId: 'listLocalDrivers',
          summary: 'Active local drivers (legacy crews), for mapping a login',
          responses: {
            '200': {
              description: 'Local drivers',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: { employeeId: { type: 'integer' }, name: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/documents/upload-url': {
        post: {
          operationId: 'createDocumentUploadUrl',
          summary: 'Request a presigned upload URL',
          description: 'Creates a pending document and returns a presigned PUT URL for S3 upload.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateUploadBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Upload URL created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'object',
                        required: ['documentId', 'uploadUrl', 'expiresInSeconds'],
                        properties: {
                          documentId: { type: 'string' },
                          uploadUrl: { type: 'string', format: 'uri' },
                          expiresInSeconds: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/api/v1/documents/{documentId}/finalize': {
        post: {
          operationId: 'finalizeDocument',
          summary: 'Finalize a document upload',
          description: 'Transitions a pending document to ACTIVE after S3 upload.',
          parameters: [
            {
              name: 'documentId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Document finalized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/Document' } },
                  },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/documents/{documentId}/download-url': {
        get: {
          operationId: 'getDocumentDownloadUrl',
          summary: 'Get a presigned download URL',
          description:
            'Returns a presigned GET URL for the document. Supports variant selection (thumb, web, original) with transparent fallback to the original.',
          parameters: [
            {
              name: 'documentId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'variant',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['thumb', 'web', 'original'],
              },
              description:
                'Variant to serve. Defaults to original. When a requested variant is pending or unavailable, the original is returned with a variantStatus hint.',
            },
          ],
          responses: {
            '200': {
              description: 'Download URL',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DownloadUrlResponse' },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/documents/entity/{entityType}/{entityId}': {
        get: {
          operationId: 'listDocumentsForEntity',
          summary: 'List documents for an entity',
          description:
            'Returns all ACTIVE documents attached to the given entity, with per-document variant status.',
          parameters: [
            {
              name: 'entityType',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['customer', 'quote', 'move', 'invoice'] },
            },
            {
              name: 'entityId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Document list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/DocumentWithVariants' },
                      },
                      meta: {
                        type: 'object',
                        required: ['count'],
                        properties: { count: { type: 'integer' } },
                      },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      // ── Integration authoring surface (the PegasusClient / CLI / MCP path) ──
      // Public discovery endpoints (no auth) + the vnd_ API-key authoring routes.
      // An external author or AI agent uses these to introspect a floor's contract
      // and author + validate + publish a config without platform source.
      '/api/v1/integrations/mapping-schema': {
        get: {
          operationId: 'getMappingSchema',
          summary: 'JSON Schema for the mapping.json DSL (public)',
          tags: ['Integrations'],
          responses: { '200': { description: 'JSON Schema of the output-shaped mapping format' } },
        },
      },
      '/api/v1/integrations/inbound-schema': {
        get: {
          operationId: 'getInboundSchema',
          summary: 'JSON Schema for the inbound ingress block (public)',
          description:
            'The publishable `inbound` block: { eventType, dedupKeyPath (string or array of paths), validation, ackTemplate }. validation supports requiredPaths + nonEmptyArrayPaths and an optional oneOf (variant shapes for a multi-shape partner — the body must satisfy at least one). ackTemplate strings that are exactly {{key}} substitute a context value; { "$map": "issues", "as": {…} } renders one element per issue.',
          tags: ['Integrations'],
          responses: { '200': { description: 'JSON Schema of the inbound block' } },
        },
      },
      // Partner-ingress bearer management (ManageIngress). The bearer a partner
      // POSTs to the pre-tenant ingress endpoint; the plaintext token is shown
      // once at provision/rotate and never again.
      '/api/v1/integrations/{integrationId}/ingress': {
        get: {
          operationId: 'getIngress',
          summary: 'Get the partner-ingress bearer status for an integration (ManageIngress)',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description:
                'Credential metadata: {url, tokenPrefix, enabled, createdAt, rotatedAt}. Never the token.',
            },
            '404': { description: 'No ingress credential provisioned' },
          },
        },
        post: {
          operationId: 'provisionIngress',
          summary: 'Provision the first partner-ingress bearer (ManageIngress)',
          description:
            'Mints the credential and returns the plaintext token ONCE. 409 if one already exists — rotate it instead.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '201': { description: '{url, token (shown once), tokenPrefix, enabled}' },
            '409': { description: 'A credential already exists' },
          },
        },
        delete: {
          operationId: 'decommissionIngress',
          summary: 'Decommission (hard-delete) the partner-ingress bearer (ManageIngress)',
          description:
            'Removes the credential; the partner token stops working immediately and provisioning becomes available again.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: '{integrationId, decommissioned: true}' },
            '404': { description: 'No ingress credential to decommission' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/ingress/rotate': {
        post: {
          operationId: 'rotateIngress',
          summary: 'Rotate the partner-ingress bearer (ManageIngress)',
          description:
            'Mints a new token (old one invalid immediately) and returns the plaintext ONCE. 404 if none exists.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: '{url, token (shown once), tokenPrefix, enabled}' },
            '404': { description: 'No ingress credential to rotate' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/ingress/test': {
        post: {
          operationId: 'testIngress',
          summary: 'Dry-run the published inbound behavior against a sample body (ManageIngress)',
          description:
            "Side-effect-free: runs the tenant's published `inbound` validation/dedup/ack against the posted sample. Persists nothing and emits no domain event. Returns {eventType, dedupId, valid, issues, ack}.",
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', description: 'A sample partner payload' },
              },
            },
          },
          responses: {
            '200': { description: '{eventType, dedupId, valid, issues, ack}' },
          },
        },
      },
      // Workflow-runtime entity reads (vnd_ workflow_runtime key). Read-only,
      // paginated (limit ≤100 / offset), returning { data, meta }. The SDK's
      // list_customers/list_quotes/list_moves/list_invoices call these.
      '/api/v1/runtime/customers': {
        get: {
          operationId: 'runtimeListCustomers',
          summary: 'List customers (workflow runtime, ReadCustomer)',
          tags: ['Runtime'],
          security: [{ ApiKeyAuth: [] }],
          responses: { '200': { description: 'Paginated customer list ({data, meta})' } },
        },
      },
      '/api/v1/runtime/quotes': {
        get: {
          operationId: 'runtimeListQuotes',
          summary: 'List quotes (workflow runtime, ReadQuote)',
          tags: ['Runtime'],
          security: [{ ApiKeyAuth: [] }],
          responses: { '200': { description: 'Paginated quote list ({data, meta})' } },
        },
      },
      '/api/v1/runtime/moves': {
        get: {
          operationId: 'runtimeListMoves',
          summary: 'List moves (workflow runtime, ReadMove)',
          tags: ['Runtime'],
          security: [{ ApiKeyAuth: [] }],
          responses: { '200': { description: 'Paginated move list ({data, meta})' } },
        },
      },
      '/api/v1/runtime/invoices': {
        get: {
          operationId: 'runtimeListInvoices',
          summary: 'List invoices (workflow runtime, ReadInvoice)',
          tags: ['Runtime'],
          security: [{ ApiKeyAuth: [] }],
          responses: { '200': { description: 'Paginated invoice list ({data, meta})' } },
        },
      },
      '/api/v1/integrations/configs': {
        get: {
          operationId: 'listIntegrations',
          summary: 'List the tenant’s configured integrations (ReadIntegrationConfig)',
          description:
            'The vnd_-reachable sibling of the Cognito-only GET /integrations. Each entry: {id, name, description, published, version, visibility}.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          responses: { '200': { description: 'Integration summaries ({data, meta})' } },
        },
      },
      '/api/v1/integrations/{integrationId}/config/fork': {
        post: {
          operationId: 'forkIntegrationConfig',
          summary: 'Fork the GLOBAL config into the tenant scope (PublishIntegrationConfig)',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'force',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true'] },
              description:
                'Refresh an existing TENANT overlay from the current GLOBAL config ' +
                'instead of failing with 409. The overlay is re-seeded as a new ' +
                'version; prior versions stay in the history and remain rollback-able.',
            },
          ],
          responses: {
            '201': { description: 'The created (or refreshed) TENANT config (full projection)' },
            '404': { description: 'No GLOBAL config to fork' },
            '409': {
              description:
                'The tenant already has its own config for this integration — ' +
                'retry with force=true to refresh it',
            },
          },
        },
      },
      // Re-declared here (after the OPERATIONAL_READ_PATHS spread) to add the
      // write beside the read: keep `get` from the read table.
      '/api/v1/workflows/{id}/triggers': {
        ...OPERATIONAL_READ_PATHS['/api/v1/workflows/{id}/triggers'],
        post: {
          operationId: 'createWorkflowTrigger',
          summary: 'Attach an EVENT or SCHEDULE trigger to an automation (ManageWorkflowTriggers)',
          description:
            'Body { kind: EVENT | SCHEDULE, eventType? (EVENT: a built-in or registered custom event type), filter? (EVENT: payload match), cronExpression? (SCHEDULE: 5-field UTC cron), enabled? (default true), dryRun? (default false) }. The trigger row belongs to the caller’s tenant, even on a GLOBAL automation. dryRun: the trigger fires on every matching event / cron minute, but every execution it starts is a dry run — reads live, mutations (send_sms, send_email, …) captured in the execution trace, never performed — so the wiring can be validated before it acts; PATCH dryRun:false to go live. Tenant-runner automations only: 400 DRY_RUN_UNSUPPORTED for a curated workflow. SDK: create_trigger; CLI: schedule create [--dry-run].',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['kind'],
                  properties: {
                    kind: { type: 'string', enum: ['EVENT', 'SCHEDULE'] },
                    eventType: { type: 'string' },
                    filter: { type: 'object' },
                    cronExpression: { type: 'string' },
                    enabled: { type: 'boolean', default: true },
                    dryRun: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description:
                '{data: {id, tenantId, workflowId, kind, eventType, filter, cronExpression, enabled, dryRun, createdByUserId, createdAt, updatedAt}}',
            },
            '400': {
              description:
                'VALIDATION_ERROR (shape, unknown event type, invalid cron or filter) | DRY_RUN_UNSUPPORTED',
            },
            '404': { description: 'NOT_FOUND — no such automation visible to this tenant' },
          },
        },
      },
      '/api/v1/workflows/{id}/triggers/{triggerId}': {
        patch: {
          operationId: 'updateWorkflowTrigger',
          summary: 'Partially update a trigger — pause/resume, re-target (ManageWorkflowTriggers)',
          description:
            'Body (all optional, at least one): { enabled, dryRun, eventType, filter, cronExpression }. enabled and dryRun apply to both kinds; eventType/filter to EVENT only; cronExpression to SCHEDULE only. kind is immutable (unknown keys are a 400). A disabled trigger is kept but never fires. A dryRun trigger keeps firing, but every execution it starts is a dry run (reads live, mutations captured in the trace, never performed) — validate the wiring, then set dryRun:false; 400 DRY_RUN_UNSUPPORTED turning it on for a curated workflow. SDK: update_trigger; CLI: schedule disable|enable|dry-run [--off].',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'triggerId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    enabled: { type: 'boolean' },
                    dryRun: { type: 'boolean' },
                    eventType: { type: 'string' },
                    filter: { type: 'object' },
                    cronExpression: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{data: trigger} — the updated row' },
            '400': { $ref: '#/components/responses/ValidationError' },
            '404': {
              description: 'NOT_FOUND — no such workflow, or the trigger is not this tenant’s',
            },
          },
        },
        delete: {
          operationId: 'deleteWorkflowTrigger',
          summary: 'Delete a trigger (ManageWorkflowTriggers)',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'triggerId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': { description: 'Deleted' },
            '404': { description: 'NOT_FOUND' },
          },
        },
      },
      '/api/v1/workflows/{id}/run': {
        post: {
          operationId: 'runWorkflow',
          summary: 'Start an execution of an automation (RunWorkflow)',
          description:
            'Body { input?: object, mode?: "dry_run" }. Starts a server-side execution and returns it (RUNNING once Temporal accepted the start). A dry run reads live but captures every mutation instead of performing it; only tenant-runner automations support it (422 DRY_RUN_UNSUPPORTED otherwise). ' +
            'Limits on tenant-runner automations: 429 CONCURRENCY_LIMIT (5 queued/running) and 429 DAILY_QUOTA_EXCEEDED (resets at midnight UTC); dry runs count toward neither. ' +
            '409 TENANT_MIGRATING (with Retry-After) while the platform moves the tenant’s automations to or from their own isolated Temporal namespace: new runs, dry runs included, are refused until in-flight runs finish (at most ~15 minutes); nothing was started, so retry. Event triggers lose nothing during a move; their events fire after it.',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '201': { description: 'Execution started ({data: execution})' },
            '400': { description: 'WORKFLOW_NOT_EXECUTABLE, or an invalid body' },
            '403': {
              description: 'WORKFLOW_MUST_FORK: fork a GLOBAL automation before running it',
            },
            '409': {
              description:
                'TENANT_MIGRATING: runs paused while the tenant’s automations move namespace; honour Retry-After',
            },
            '422': { description: 'DRY_RUN_UNSUPPORTED' },
            '423': { description: 'WORKFLOWS_DISABLED for this tenant' },
            '429': { description: 'CONCURRENCY_LIMIT | DAILY_QUOTA_EXCEEDED' },
            '502': { description: 'TEMPORAL_START_FAILED' },
          },
        },
      },
      '/api/v1/workflows/{id}/executions/{executionId}/cancel': {
        post: {
          operationId: 'cancelWorkflowExecution',
          summary: 'Request cancellation of a running execution (CancelWorkflowExecution)',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'executionId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '202': { description: 'Cancellation requested ({data: execution})' } },
        },
      },
      '/api/v1/workflows/{id}/executions/{executionId}/retry': {
        post: {
          operationId: 'retryWorkflowExecution',
          summary: 'Retry a terminal-failed execution as a new run (RetryWorkflowExecution)',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'executionId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '201': { description: 'New execution started ({data: execution})' },
            '409': {
              description:
                'Execution not in a retryable state, or TENANT_MIGRATING (runs paused while the tenant’s automations move namespace; honour Retry-After)',
            },
          },
        },
      },
      // Re-declared here (after the OPERATIONAL_READ_PATHS spread) to add the
      // write beside the read: keep `get` from the read table.
      '/api/v1/pegii/orders/{orderId}': {
        ...OPERATIONAL_READ_PATHS['/api/v1/pegii/orders/{orderId}'],
        patch: {
          operationId: 'updatePegiiOrder',
          summary: 'Write allowlisted fields back onto a pegII order (WriteOrder, billable)',
          description:
            'Body: a native-shape fragment, the vocabulary GET ?shape=native returns, e.g. {"Survey": {"SerivceStatus": "In Progress", "APIShipmentStatus": "Loaded"}}. ' +
            "Writable paths (enforced by the pegII site): Survey.SerivceStatus (pegII's own spelling; sales.whse_remarks5, up to 80 chars) and Survey.APIShipmentStatus (sales.special2, up to 50 chars). " +
            'Values are strings, stored verbatim; omitted fields are unchanged. Any other path (including Survey.ShipmentStatus, which does not exist) is a 400 naming it, and nothing is written. ' +
            'Re-sending the values already on the order is a 200 with meta.applied: false, and is not billed. The order and its stored native snapshot change together, and the 200 returns the order exactly as GET ?shape=native does afterwards. ' +
            "No order-saved event is emitted. 503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.orders.write.v1.",
          tags: ['pegII'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: {
                    Survey: { SerivceStatus: 'In Progress', APIShipmentStatus: 'Loaded' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: '{data: <native order after the write>, meta: {applied: boolean}}',
            },
            '400': {
              description:
                'VALIDATION_ERROR naming the path (not writable, not a string, too long) or EMPTY_PATCH; nothing written',
            },
            '403': { description: 'Missing WriteOrder' },
            '404': {
              description:
                'ORDER_NOT_FOUND, or ORDER_SNAPSHOT_MISSING (never saved by a current MoveManager desktop; nothing written)',
            },
            '503': { description: 'PEGII_CAPABILITY_MISSING / PEGII_SOURCE_UNAVAILABLE' },
          },
        },
      },
      '/api/v1/pegii/orders/{orderId}/memos': {
        post: {
          operationId: 'createPegiiOrderMemo',
          summary: 'Add a memo to a pegII order (WriteOrderMemo, billable)',
          description:
            'Body: { memoType, subject, text, nextAction?, nextDate?, personCode?, dedupKey? }. ' +
            'MoveManager shows it on the order\'s memo screen like one a user typed: subject is its "Re:" (up to 150, stored uppercased), text its "Notes:" (up to 1000), nextAction its "Next Action" (up to 100). ' +
            'It lands on the "Memos I need to acknowledge" list of personCode (a MoveManager employee code; default: the order\'s coordinator) from nextDate (YYYY-MM-DD; default: the site\'s today). ' +
            "memoType is the stored code 1-7; its label is the company's (GET /api/v1/pegii/memo-types). Who called is the calling service employee. " +
            "400 MEMO_TEXT_TRIGGERS_REJECTION when the site refuses text its memo trigger would treat as a rejection (text containing 'rejected'); reword it. " +
            'dedupKey (up to 190) makes it idempotent: the same key with the same request is 200 alreadyExists: true with the original memo, not billed; with a different request, 409 IDEMPOTENCY_KEY_REUSED. ' +
            "503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.memos.v1.",
          tags: ['pegII'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['memoType', 'subject', 'text'],
                  example: {
                    memoType: 4,
                    subject: 'Pulse reply',
                    text: 'Customer replied: the crew was great.',
                    dedupKey: 'pulse-memo-490317-4455',
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description:
                '{data: {id, orderId, memoType, subject, text, nextAction, nextDate, callDate, callTime, whoCalled, shipper, personCode, acknowledged, createdBy, alreadyExists: false}}',
            },
            '200': {
              description: '{data: {...memo, alreadyExists: true}} — a dedupKey replay, not billed',
            },
            '400': {
              description:
                "VALIDATION_ERROR, or the site's MEMO_TEXT_TRIGGERS_REJECTION / UNKNOWN_PERSON / INVALID_MEMO_TYPE / INVALID_SUBJECT / INVALID_TEXT / INVALID_NEXT_ACTION / INVALID_NEXT_DATE",
            },
            '403': { description: 'Missing WriteOrderMemo' },
            '404': { description: 'ORDER_NOT_FOUND' },
            '409': {
              description:
                "IDEMPOTENCY_KEY_REUSED (same dedupKey, different request) or IDEMPOTENT_MEMO_DELETED (the key's memo was deleted in MoveManager); nothing written",
            },
            '503': { description: 'PEGII_CAPABILITY_MISSING / PEGII_SOURCE_UNAVAILABLE' },
          },
        },
      },
      // Re-declared here (after the OPERATIONAL_READ_PATHS spread) to add the
      // create beside the list: keep `get` from the read table.
      '/api/v1/pegii/tasks': {
        ...OPERATIONAL_READ_PATHS['/api/v1/pegii/tasks'],
        post: {
          operationId: 'createPegiiTask',
          summary: 'Create a task on a pegII order (CreateTask, billable)',
          description:
            'Body: { orderId, taskType, title, dueDate, description?, priority?, assigneeCode?, dedupKey? }. ' +
            'MoveManager shows it as a user-defined (USRDEF) task on the order: the coordinator sees, edits and completes it like their own; its grid text is the title uppercased and cut to 50. ' +
            'taskType must be a type the site registers (today: Pulse Follow-Up); title up to 200; description (the task note) up to 1000; priority low | normal | high (default normal); ' +
            "dueDate YYYY-MM-DD, required; assigneeCode a MoveManager employee code (default: the order's coordinator). " +
            'dedupKey (up to 190) makes it idempotent: the same key with the same request is 200 alreadyExists: true with the original task, not billed; with a different request, 409 IDEMPOTENCY_KEY_REUSED. ' +
            "503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.tasks.v1.",
          tags: ['pegII'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['orderId', 'taskType', 'title', 'dueDate'],
                  example: {
                    orderId: '490317',
                    taskType: 'Pulse Follow-Up',
                    title: 'Call back the shipper',
                    dueDate: '2026-10-20',
                    priority: 'high',
                    dedupKey: 'pulse-490317-2026-10-16',
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: '{data: {...task, alreadyExists: false}}' },
            '200': {
              description: '{data: {...task, alreadyExists: true}} — a dedupKey replay, not billed',
            },
            '400': {
              description:
                "VALIDATION_ERROR, or the site's UNKNOWN_TASK_TYPE / INVALID_TITLE / INVALID_DUE_DATE / INVALID_PRIORITY / INVALID_DESCRIPTION / UNKNOWN_ASSIGNEE",
            },
            '403': { description: 'Missing CreateTask' },
            '404': { description: 'ORDER_NOT_FOUND' },
            '409': {
              description:
                "IDEMPOTENCY_KEY_REUSED (same dedupKey, different request) or IDEMPOTENT_TASK_DELETED (the key's task was deleted in MoveManager); nothing written",
            },
            '503': { description: 'PEGII_CAPABILITY_MISSING / PEGII_SOURCE_UNAVAILABLE' },
          },
        },
      },
      '/api/v1/pegii/tasks/close': {
        post: {
          operationId: 'closePegiiTask',
          summary: 'Close a pegII task by taskId, or by (orderId, taskType) (CloseTask, billable)',
          description:
            'Body: { taskId } or { orderId, taskType }, plus reason? (up to 1000). Exactly one form. Closes ANY task, as a coordinator would: completed, completion time and employee, the actual date if empty; ' +
            "the reason is appended to the task note as 'Closed by Pegasus: …'. By (orderId, taskType) the order's OPEN tasks of that type decide: one is closed; two or more is 409 TASK_AMBIGUOUS with candidateIds and nothing closed; " +
            'none open but some closed returns the latest with alreadyClosed: true. Idempotent: closing a closed task is 200 alreadyClosed: true, not billed. ' +
            "A refused close (404, 409) is not billed. 503 PEGII_CAPABILITY_MISSING when the site's pegII API predates pegii.tasks.v1.",
          tags: ['pegII'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: { taskId: '1234567', reason: 'Customer replied' },
                },
              },
            },
          },
          responses: {
            '200': { description: '{data: {...task, alreadyClosed: boolean}}' },
            '400': {
              description:
                'VALIDATION_ERROR (neither or both forms, orderId not a pegII order number)',
            },
            '403': { description: 'Missing CloseTask' },
            '404': {
              description:
                'TASK_NOT_FOUND (no such task, or no task of that type on the order) or ORDER_NOT_FOUND',
            },
            '409': {
              description:
                'TASK_AMBIGUOUS {candidateIds[]}: two or more open tasks of that type; nothing closed',
            },
            '503': { description: 'PEGII_CAPABILITY_MISSING / PEGII_SOURCE_UNAVAILABLE' },
          },
        },
      },
      '/api/v1/workflows/retire': {
        post: {
          operationId: 'retireWorkflow',
          summary: 'Retire a published automation, every version or one (UploadWorkflow)',
          description:
            'Body: { name, version? }. Soft retire: the rows stay for audit and their executions stay readable, but a retired row is no longer listed (unless ?includeRetired=true), fetched, run, forked, downloaded or triggered. Only the owning tenant can retire, so a platform (GLOBAL) workflow is retired by the platform tenant; another tenant gets 403. All-or-nothing, and refused 409 WORKFLOW_IN_USE while any matching row has an ENABLED trigger or a QUEUED/RUNNING execution from ANY tenant, naming them. Tenant forks are separate rows and keep running; their count is returned. Versions stay immutable: re-pushing a retired name@version still 409s. Idempotent: already-retired versions are reported in alreadyRetired.',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          responses: {
            '200': { description: '{data: {retired[], alreadyRetired[], forkCount}}' },
            '403': { description: 'A visible platform workflow the caller does not own' },
            '404': { description: 'Nothing by that name/version is visible' },
            '409': {
              description: 'WORKFLOW_IN_USE {enabledTriggers[], openExecutions[]}; nothing retired',
            },
          },
        },
      },
      '/api/v1/workflows/{id}/retire': {
        post: {
          operationId: 'retireWorkflowById',
          summary: 'Retire one published automation version by id (UploadWorkflow)',
          description: 'Same contract as retireWorkflow, scoped to the single row `id`.',
          tags: ['Workflows'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: '{data: {retired[], alreadyRetired[], forkCount}}' },
            '403': { description: 'A visible platform workflow the caller does not own' },
            '404': { description: 'Not visible' },
            '409': { description: 'WORKFLOW_IN_USE; nothing retired' },
          },
        },
      },
      '/api/v1/feedback-forms/{formKey}': {
        get: {
          operationId: 'getFeedbackForm',
          summary: 'Get the active feedback form for a key (ReadFeedbackForms)',
          tags: ['Feedback'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'formKey', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'The active form (full projection)' },
            '404': { description: 'No published form' },
          },
        },
        post: {
          operationId: 'publishFeedbackForm',
          summary: 'Publish a new immutable feedback form version (ManageFeedbackForms)',
          description:
            'Body: { title, definition: { questions: [...] }, messageTemplate? }. Every question takes id, type, label and required? and the keys its type adds: rating → min, max (default 1..5), display ("numeric" default | "faces" ≤ 7 points | "stars"; presentation only, the answer stays an integer), scaleLabels ({ "<point>": "caption" }); number → min, max; text → maxLength; select → options[]; boolean → none. Keys are strict: an unrecognized question key, or a top-level key other than `questions`, is a 400 naming it. A publish supersedes the prior published version for the key.',
          tags: ['Feedback'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'formKey', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '201': { description: 'The published form version (full projection)' },
            '400': { description: 'Invalid form key or definition' },
            '404': { description: 'Feedback is not enabled' },
          },
        },
      },
      '/api/v1/feedback-forms/{formKey}/validate': {
        post: {
          operationId: 'validateFeedbackForm',
          summary: 'Dry-run a feedback form definition, no write (ManageFeedbackForms)',
          description:
            'Same checks as publish (see publishFeedbackForm for the per-type key allowlist); `valid: false` lists every problem, including unrecognized keys.',
          tags: ['Feedback'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'formKey', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{data: { valid, errors }}' } },
        },
      },
      '/api/v1/feedback-forms/{formKey}/rollback/{version}': {
        post: {
          operationId: 'rollbackFeedbackForm',
          summary: 'Re-publish a prior feedback form version (ManageFeedbackForms)',
          tags: ['Feedback'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'formKey', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '201': { description: 'The re-published form version' },
            '404': { description: 'Version not found' },
          },
        },
      },
      '/api/v1/feedback-requests': {
        post: {
          operationId: 'createFeedbackRequest',
          summary: 'Mint a capability link to a published form (CreateFeedbackRequest)',
          description:
            'Body: { formKey, subject: { type, id }, ttlHours?, channel?, to? }. Returns { requestId, url, expiresAt }. Pass channel:"sms" + to to also send the rendered message via the tenant’s RingCentral connection (best-effort; the response always carries the url and a delivery status).',
          tags: ['Feedback'],
          security: [{ ApiKeyAuth: [] }],
          responses: {
            '201': { description: '{data: { requestId, url, expiresAt, delivery? }}' },
            '400': { description: 'Invalid body (e.g. bad E.164 when channel is sms)' },
            '404': { description: 'No published form for the key, or feedback not enabled' },
          },
        },
      },
      '/api/public/v1/feedback/{token}': {
        get: {
          operationId: 'getPublicFeedbackForm',
          summary: 'Public: the form definition to render for a capability token',
          description:
            'No auth — the opaque token in the path resolves the tenant + pinned form version. Leaks no subject PII: returns { status: pending|submitted|expired, title, definition }.',
          tags: ['Feedback'],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: '{data: { status, title, definition }}' },
            '404': { description: 'Invalid/unknown token' },
          },
        },
        post: {
          operationId: 'submitPublicFeedback',
          summary: 'Public: submit a response for a capability token',
          description:
            'Body: { response: { [questionId]: value } } (or the bare response object). Validated against the pinned form; on success records the response (single-submit) and emits the built-in feedback.submitted domain event.',
          tags: ['Feedback'],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '201': { description: '{data: { status: "submitted" }}' },
            '400': { description: 'Response failed validation' },
            '409': { description: 'Already submitted' },
            '410': { description: 'Link expired' },
          },
        },
      },
      '/api/v1/integrations/floors': {
        get: {
          operationId: 'listFloors',
          summary: 'List built-in integration floors (public)',
          description:
            'Each floor is a per-type, partner-neutral contract. Returns each floor id + its canonicalFields (legal mapping targets) + requiredCanonicalFields (the subset a mapping must produce) + factCatalog (legal rule facts) + factDocs (what each fact means, when documented) + inputFieldRoots (legal mapping source roots, when declared) + defaultAction + projection.',
          tags: ['Integrations'],
          responses: {
            '200': { description: 'data: array of floor detail objects (see /floors/{floorId})' },
          },
        },
      },
      '/api/v1/integrations/floors/{floorId}': {
        get: {
          operationId: 'getFloor',
          summary: 'A floor’s machine-readable contract (public)',
          description:
            'The contract an author writes a config AGAINST: `canonicalFields` are the only legal mapping targets, and `requiredCanonicalFields` is the subset a mapping must produce (the rest may be left out); `factCatalog` are the only legal rule facts; `factDocs` (when present) says what each fact MEANS — read it before choosing between similarly-named facts, since AND-ed count predicates are evaluated independently (a paired fact exists where two dates must belong to the same related record), and counts of related records use the `{op:"lte", value:0}` idiom for "at least one"; `inputFieldRoots` (when present) are the legal mapping SOURCE roots a `$from` may read — a bare entry opens a whole native root, a dotted entry opens only that curated sub-path, and the gate enforces them against every `$from`, composing reads inside `$each` with the array\'s own source path so element-scope reads are checked in order scope.',
          tags: ['Integrations'],
          parameters: [{ name: 'floorId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Floor detail',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          floor: { type: 'string' },
                          canonicalFields: { type: 'array', items: { type: 'string' } },
                          requiredCanonicalFields: {
                            type: 'array',
                            items: { type: 'string' },
                            description:
                              'The subset of canonicalFields a mapping MUST produce. The key must be present, though a nullable one may be null. Any canonicalField not listed here may be left out.',
                          },
                          factCatalog: {
                            type: 'object',
                            additionalProperties: { enum: ['string', 'number', 'boolean'] },
                          },
                          factDocs: {
                            type: 'object',
                            description:
                              'Fact name → one-line meaning. Present when the floor documents its facts; every key is a factCatalog fact.',
                            additionalProperties: { type: 'string' },
                          },
                          inputFieldRoots: { type: 'array', items: { type: 'string' } },
                          defaultAction: { type: 'string' },
                          projection: {
                            type: 'object',
                            properties: {
                              entityType: { type: 'string' },
                              localEntityType: {
                                type: 'string',
                                description:
                                  'The local entity kind a projection on this floor may be correlated to (put_projection local_entity_type). Absent ⇒ correlation is `unsupported`.',
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/validate': {
        post: {
          operationId: 'validateIntegration',
          summary: 'Validate a native payload against an integration (API key)',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['order'],
                  properties: {
                    order: {},
                    prior: {},
                    action: { enum: ['save', 'cancel', 'status-change'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ valid, issues[], degraded }' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/map-to-external': {
        post: {
          operationId: 'mapToExternal',
          summary: 'Map entity data → partner external body (API key)',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: { data: {}, action: { enum: ['save', 'cancel', 'status-change'] } },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ external, valid, issues[], degraded }' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/map-from-external': {
        post: {
          operationId: 'mapFromExternal',
          summary: 'Normalize a native payload → canonical entity (API key)',
          description:
            'Inbound mirror of map-to-external. Returns { canonical, valid, issues[], degraded }; canonical is null only when unmappable. 404 (fails closed) on unknown integration / no floor.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['data'], properties: { data: {} } },
              },
            },
          },
          responses: {
            '200': { description: '{ canonical, valid, issues[], degraded }' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/call-external': {
        post: {
          operationId: 'callExternal',
          summary: 'Call a partner API server-side with the integration’s configured auth',
          description:
            'Performs an authenticated outbound HTTP call against the integration’s BASE_URL so credentials never enter workflow code. Auth comes from CONFIG AUTH_MODE: `oauth2_client_credentials` (default; mints + caches a token, re-mints once on 401), `bearer` (SECRET API_KEY as a bearer), `apikey` (SECRET API_KEY sent as the header named by CONFIG API_KEY_HEADER, default `Ocp-Apim-Subscription-Key` — the Azure API Management convention), or `none`. Extra headers come from `headers` (literal, non-secret) and `secretHeaders` (header name → SECRET key name, resolved server-side); Authorization/Host/Content-Length/Content-Type are reserved and rejected, as are non-token header names and CR/LF-bearing values. 429/503 are retried with `Retry-After` honored (capped at 10s) up to CONFIG MAX_RETRIES (default 2) — but ONLY for idempotent requests (GET/HEAD/OPTIONS, or an explicit `mutating: false`). CONFIG REQUEST_TIMEOUT_MS (default 30000, clamped to [1000, 60000]) bounds each attempt.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['method', 'path'],
                  properties: {
                    method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
                    path: { type: 'string', description: 'appended to BASE_URL' },
                    query: { type: 'object', additionalProperties: true },
                    body: { description: 'JSON request body (mutations)' },
                    mutating: {
                      type: 'boolean',
                      description:
                        'Force read (false) / mutation (true) classification. Also gates retry: only non-mutating requests are retried.',
                    },
                    responseToBlob: {
                      type: 'boolean',
                      description:
                        'Land the response body into a blob instead of returning inline.',
                    },
                    headers: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                      description: 'Literal, NON-SECRET request headers (e.g. On-Behalf-Of).',
                    },
                    secretHeaders: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                      description:
                        'Header name → SECRET key name; the platform resolves the value from the encrypted store.',
                    },
                    group: { type: 'string', default: 'global' },
                    baseUrlConfig: { type: 'string', default: 'BASE_URL' },
                    authModeConfig: { type: 'string', default: 'AUTH_MODE' },
                    tokenUrlConfig: { type: 'string', default: 'TOKEN_URL' },
                    clientIdSecret: { type: 'string', default: 'CLIENT_ID' },
                    clientSecretSecret: { type: 'string', default: 'CLIENT_SECRET' },
                    bearerSecret: { type: 'string', default: 'API_KEY' },
                    apiKeyHeaderConfig: { type: 'string', default: 'API_KEY_HEADER' },
                    timeoutConfig: { type: 'string', default: 'REQUEST_TIMEOUT_MS' },
                    maxRetriesConfig: { type: 'string', default: 'MAX_RETRIES' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                '{ status, ok, response | blobId+size, headers (all partner response headers, lowercase, minus set-cookie), attempts, dryRun }',
            },
            '400': { description: 'Bad body, disallowed URL, or a rejected custom header' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { description: 'Token mint or outbound call could not be completed' },
            '504': { description: 'Partner did not respond within the timeout' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/deliver-to-external': {
        post: {
          operationId: 'deliverToExternal',
          summary: 'POST a mapped partner body server-side (API key)',
          description:
            'The single fixed JSON POST counterpart to call-external. Reads the delivery URL from CONFIG (default SEND_URL) and a bearer key from SECRET (default SEND_API_KEY). Extra headers: `headers` (literal, non-secret), `secretHeaders` (header name → SECRET key name, resolved server-side — the safe home for a credential), and the legacy `headersConfig` (a CONFIG row holding a JSON object; NON-SECRET ONLY, since CONFIG values are stored in plaintext). Always a mutation, so it is never auto-retried; CONFIG REQUEST_TIMEOUT_MS still bounds it.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['external'],
                  properties: {
                    external: { description: 'The mapped partner payload to POST.' },
                    urlConfig: { type: 'string', default: 'SEND_URL' },
                    apiKeySecret: { type: 'string', default: 'SEND_API_KEY' },
                    headersConfig: {
                      type: 'string',
                      description: 'CONFIG key holding extra headers as JSON. Non-secret only.',
                    },
                    headers: { type: 'object', additionalProperties: { type: 'string' } },
                    secretHeaders: { type: 'object', additionalProperties: { type: 'string' } },
                    timeoutConfig: { type: 'string', default: 'REQUEST_TIMEOUT_MS' },
                    group: { type: 'string', default: 'global' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ delivered, status, response, headers, dryRun }' },
            '400': { description: 'Bad body, disallowed URL, or a rejected custom header' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { description: 'The outbound POST could not be completed' },
            '504': { description: 'Partner did not respond within the timeout' },
          },
        },
      },
      '/api/v1/integrations/{integrationId}/config': {
        get: {
          operationId: 'getIntegrationConfig',
          summary: 'Fetch the published config overlay (API key)',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description:
                '{ mapping, rules, corpus, floor, displayName, externalShape, externalMapping, inbound }',
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        post: {
          operationId: 'publishIntegrationConfig',
          summary: 'Validate (dry-run) or publish a config overlay (API key, platform tenant)',
          description:
            'The full authoring surface. `floor` is required for a new id with no built-in overlay. `inbound` is the ingress ack/validation block (see /integrations/inbound-schema). Gated by PublishIntegrationConfig + INTEGRATION_CONFIG_PUBLISH_ENABLED.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['mapping', 'rules', 'corpus'],
                  properties: {
                    mapping: {
                      description: 'output-shaped mapping DSL (see /integrations/mapping-schema)',
                    },
                    rules: {
                      type: 'array',
                      description: 'rule set; ops eq/ne/gt/gte/lt/lte/in/nin',
                    },
                    corpus: {
                      type: 'array',
                      description: 'gate cases: { input: { order }, expected }',
                    },
                    floor: { type: 'string' },
                    displayName: { type: 'string' },
                    externalShape: { type: 'object' },
                    externalMapping: {},
                    inbound: { type: 'object', description: 'see /integrations/inbound-schema' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'gate report { ok, problems[], corpus }' },
            '400': { $ref: '#/components/responses/ValidationError' },
          },
        },
        delete: {
          operationId: 'deleteIntegrationConfig',
          summary: 'Delete the caller’s published config for an integration (API key)',
          description:
            'Hard-deletes the caller’s ENTIRE version lineage for this integration — the platform tenant’s GLOBAL config, or any other tenant’s own overlay (after which it re-inherits GLOBAL). Irreversible: no version survives in /config/versions. An id that also has a built-in code overlay keeps resolving to that baseline; a config-only id disappears entirely. Deleting a GLOBAL that other tenants still overlay returns 409 unless `force=true` (which never touches their rows). Gated by PublishIntegrationConfig + INTEGRATION_CONFIG_PUBLISH_ENABLED.',
          tags: ['Integrations'],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'integrationId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'force',
              in: 'query',
              required: false,
              schema: { type: 'boolean' },
              description:
                'Delete a GLOBAL config even though other tenants still have their own overlay for the id.',
            },
          ],
          responses: {
            '200': { description: '{ data: { integrationId, visibility, deleted } }' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': {
              description:
                'DEPENDENTS_EXIST — other tenants still overlay this id; retry with force=true',
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A Pegasus vendor API key (vnd_…) in `Authorization: Bearer <key>`. The key’s service account holds the required Cedar action (e.g. workflow_developer / integration_publisher).',
        },
      },
      parameters: {
        IdPath: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Resource identifier (UUID)',
        },
      },
      schemas: {
        ChatMessage: {
          type: 'object',
          required: [
            'id',
            'clientMessageId',
            'body',
            'author',
            'mentionedUserIds',
            'createdAt',
            'deletedAt',
          ],
          properties: {
            id: { type: 'string' },
            clientMessageId: { type: 'string' },
            body: { type: ['string', 'null'], description: 'null once deleted' },
            author: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
            mentionedUserIds: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        LaborCrew: {
          type: 'object',
          description:
            'A crew as the caller sees it — from their own list, their company list, or both. name/email/serviceAreas/packers are shared by every driver who added the number; nickname and myRating are private (null unless inMyList). averageRating is anonymous and null below 3 raters.',
          required: ['phone', 'name', 'displayName', 'serviceAreas', 'packerCount'],
          properties: {
            phone: { type: 'string', description: 'E.164 — the crew’s identity' },
            phoneDisplay: { type: 'string' },
            name: { type: 'string' },
            nickname: { type: ['string', 'null'] },
            companyNickname: { type: ['string', 'null'], description: 'The company display name' },
            displayName: { type: 'string', description: 'nickname ?? companyNickname ?? name' },
            email: { type: ['string', 'null'] },
            serviceAreas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  city: { type: 'string' },
                  region: { type: 'string' },
                  country: { type: 'string', enum: ['US', 'CA'] },
                  geocoded: { type: 'boolean' },
                },
              },
            },
            packerCount: { type: 'integer' },
            myRating: {
              type: ['object', 'null'],
              properties: {
                stars: { type: 'integer', minimum: 1, maximum: 5 },
                comment: { type: ['string', 'null'] },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
            averageRating: {
              type: ['object', 'null'],
              properties: { average: { type: 'number' }, count: { type: 'integer' } },
            },
            addedAt: { type: 'string', format: 'date-time' },
            inMyList: { type: 'boolean' },
            inCompanyList: { type: 'boolean' },
            canRemoveFromCompany: {
              type: 'boolean',
              description: 'On the company list and the caller holds an Operations role',
            },
            distanceMiles: {
              type: ['number', 'null'],
              description: 'Only on a location search',
            },
          },
        },
        LaborCrewDetail: {
          allOf: [
            { $ref: '#/components/schemas/LaborCrew' },
            {
              type: 'object',
              properties: {
                packers: { type: 'array', items: { $ref: '#/components/schemas/LaborPacker' } },
              },
            },
          ],
        },
        LaborPacker: {
          type: 'object',
          required: ['id', 'firstName', 'lastName'],
          properties: {
            id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: ['string', 'null'] },
            cidNumber: { type: ['string', 'null'] },
            cidIssuedOn: { type: ['string', 'null'], format: 'date' },
            phone: { type: ['string', 'null'] },
            phoneDisplay: { type: ['string', 'null'] },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        LaborCrewMember: {
          type: 'object',
          description: "A packer on the caller's own My Crew.",
          required: ['id', 'firstName', 'lastName', 'everyJob'],
          properties: {
            id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: ['string', 'null'] },
            cidNumber: { type: ['string', 'null'] },
            cidIssuedOn: { type: ['string', 'null'], format: 'date' },
            phone: { type: ['string', 'null'] },
            phoneDisplay: { type: ['string', 'null'] },
            everyJob: {
              type: 'boolean',
              description: 'Added to my labor activities whenever one of my trips is accepted',
            },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        LaborActivity: {
          type: 'object',
          description: 'A legacy longhaul activity with the crews and packers that worked it.',
          required: ['id', 'orderNum', 'editable', 'crews'],
          properties: {
            id: { type: 'integer' },
            orderNum: { type: 'integer' },
            typeCode: { type: ['string', 'null'] },
            typeName: { type: ['string', 'null'] },
            typeAbbreviation: { type: ['string', 'null'] },
            plannedStart: { type: ['string', 'null'], format: 'date' },
            estimatedDate: { type: ['string', 'null'], format: 'date' },
            actualDate: { type: ['string', 'null'], format: 'date' },
            editable: {
              type: 'boolean',
              description: "True when the caller is the activity's driver",
            },
            myCrew: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'firstName', 'lastName', 'everyJob', 'mine', 'selected'],
                properties: {
                  id: { type: 'string' },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  phoneDisplay: { type: ['string', 'null'] },
                  everyJob: { type: 'boolean' },
                  mine: {
                    type: 'boolean',
                    description: "In the caller's My Crew now — only these may be newly ticked",
                  },
                  selected: { type: 'boolean', description: 'Worked this activity' },
                },
              },
            },
            crews: {
              type: 'array',
              items: {
                type: 'object',
                required: ['phone', 'name', 'displayName', 'inMyBook', 'packers'],
                properties: {
                  phone: { type: 'string' },
                  phoneDisplay: { type: 'string' },
                  name: { type: 'string' },
                  nickname: { type: ['string', 'null'], description: "The caller's private name" },
                  displayName: { type: 'string' },
                  inMyBook: { type: 'boolean' },
                  inCompanyList: { type: 'boolean' },
                  packers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'firstName', 'lastName', 'selected'],
                      properties: {
                        id: { type: 'string' },
                        firstName: { type: 'string' },
                        lastName: { type: 'string' },
                        phoneDisplay: { type: ['string', 'null'] },
                        selected: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        ReportingDataset: {
          type: 'object',
          description:
            'A dataset contract. `id` is a permanent public identifier and `version` bumps on ' +
            'any breaking column change — a stored dashboard records both so it can detect drift.',
          required: ['id', 'version', 'title', 'source', 'permission', 'columns'],
          properties: {
            id: { type: 'string', example: 'moves-by-status' },
            version: { type: 'integer' },
            title: { type: 'string' },
            description: { type: 'string' },
            source: {
              type: 'string',
              enum: ['postgres', 'legacy-mssql'],
              description:
                'Where the data physically lives. `legacy-mssql` datasets are unavailable for a ' +
                'tenant with no on-prem database configured and will return MSSQL_NOT_CONFIGURED ' +
                'in their result slot.',
            },
            permission: {
              type: 'string',
              description: 'The pre-existing permission the caller must also hold.',
              example: 'move:list',
            },
            columns: {
              type: 'array',
              items: {
                type: 'object',
                required: ['key', 'label', 'type'],
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['string', 'number', 'currency', 'date', 'boolean'],
                  },
                },
              },
            },
            paramsSchema: {
              type: 'object',
              description: 'JSON Schema for this dataset’s params.',
              additionalProperties: true,
            },
          },
        },
        DashboardDocument: {
          type: 'object',
          description:
            'The portable dashboard document. schemaVersion 1 (span-based, phase 1) is ' +
            'accepted and upgraded server-side to 2 (grid layout); both are stored as 2.',
          required: ['schemaVersion', 'widgets'],
          properties: {
            schemaVersion: { type: 'integer', enum: [1, 2] },
            widgets: {
              type: 'array',
              minItems: 1,
              maxItems: 12,
              description: 'Capped at 12 to match the query endpoint’s batch limit.',
              items: {
                type: 'object',
                required: ['datasetId', 'datasetVersion', 'widget', 'title'],
                properties: {
                  datasetId: { type: 'string' },
                  datasetVersion: {
                    type: 'integer',
                    description:
                      'The dataset version this widget was authored against. A mismatch ' +
                      'against the live registry is reported as a drift warning, never an error.',
                  },
                  params: { type: 'object', additionalProperties: true },
                  widget: { type: 'string', enum: ['scalar', 'bar', 'line', 'table'] },
                  title: { type: 'string' },
                  span: {
                    type: 'integer',
                    enum: [1, 2, 3, 4],
                    description: 'v1 geometry, retained for rollback safety.',
                  },
                  layout: {
                    type: 'object',
                    description: 'v2 grid geometry on a 12-column grid.',
                    required: ['x', 'y', 'w', 'h'],
                    properties: {
                      x: { type: 'integer' },
                      y: { type: 'integer' },
                      w: { type: 'integer' },
                      h: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        Dashboard: {
          type: 'object',
          required: ['slug', 'version', 'title', 'visibility', 'definition', 'owned'],
          properties: {
            slug: { type: 'string' },
            version: { type: 'integer' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            visibility: { type: 'string', enum: ['GLOBAL', 'TENANT'] },
            definition: { $ref: '#/components/schemas/DashboardDocument' },
            updatedAt: { type: 'string', format: 'date-time' },
            owned: {
              type: 'boolean',
              description: 'Belongs to the calling tenant, rather than being a GLOBAL one.',
            },
            forkable: {
              type: 'boolean',
              description: 'A GLOBAL dashboard this tenant has not forked yet.',
            },
            forkedFrom: {
              type: 'object',
              nullable: true,
              properties: {
                definitionId: { type: 'string' },
                version: { type: 'integer', nullable: true },
              },
            },
            warnings: {
              type: 'array',
              description: 'Dataset-version drift detected at publish. Informational.',
              items: {
                type: 'object',
                properties: {
                  datasetId: { type: 'string' },
                  authoredAgainst: { type: 'integer' },
                  current: { type: 'integer' },
                },
              },
            },
          },
        },
        UserPreferences: {
          type: 'object',
          properties: {
            reporting: {
              type: 'object',
              properties: {
                defaultDashboardSlug: {
                  type: 'string',
                  nullable: true,
                  description:
                    'A SLUG, never a dashboard id: an id would pin the user to one immutable ' +
                    'version. Null clears the default.',
                },
              },
            },
          },
        },
        ReportingResult: {
          type: 'object',
          description: 'One result slot. Carries either `rows` or `error`, never both.',
          required: ['datasetId'],
          properties: {
            datasetId: { type: 'string' },
            rows: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            error: {
              type: 'object',
              required: ['message', 'code'],
              properties: {
                message: { type: 'string' },
                code: {
                  type: 'string',
                  enum: ['DATASET_ERROR', 'MSSQL_NOT_CONFIGURED'],
                },
              },
            },
          },
        },
        Customer: {
          type: 'object',
          required: ['id', 'tenantId', 'firstName', 'lastName', 'email'],
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            accountId: { type: 'string' },
            leadSourceId: { type: 'string' },
          },
        },
        Contact: {
          type: 'object',
          required: ['id', 'customerId', 'firstName', 'lastName', 'email', 'isPrimary'],
          properties: {
            id: { type: 'string' },
            customerId: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            isPrimary: { type: 'boolean' },
          },
        },
        CreateCustomerBody: {
          type: 'object',
          required: ['userId', 'firstName', 'lastName', 'email', 'primaryContact'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            firstName: { type: 'string', minLength: 1 },
            lastName: { type: 'string', minLength: 1 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', minLength: 1 },
            accountId: { type: 'string', minLength: 1 },
            leadSourceId: { type: 'string', minLength: 1 },
            primaryContact: { $ref: '#/components/schemas/ContactBody' },
          },
        },
        UpdateCustomerBody: {
          type: 'object',
          properties: {
            firstName: { type: 'string', minLength: 1 },
            lastName: { type: 'string', minLength: 1 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', minLength: 1 },
          },
        },
        ContactBody: {
          type: 'object',
          required: ['firstName', 'lastName', 'email'],
          properties: {
            firstName: { type: 'string', minLength: 1 },
            lastName: { type: 'string', minLength: 1 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', minLength: 1 },
            isPrimary: { type: 'boolean' },
          },
        },
        CreateUploadBody: {
          type: 'object',
          required: ['entityType', 'entityId', 'documentType', 'filename', 'mimeType', 'sizeBytes'],
          properties: {
            entityType: { type: 'string', enum: ['customer', 'quote', 'move', 'invoice'] },
            entityId: { type: 'string', minLength: 1 },
            documentType: { type: 'string', minLength: 1 },
            filename: { type: 'string', minLength: 1 },
            mimeType: {
              type: 'string',
              description:
                'Allowed prefixes: image/* (including image/heic, image/heif), application/pdf, application/msword, application/vnd.openxmlformats-officedocument.*, text/*',
            },
            sizeBytes: { type: 'integer', minimum: 1, maximum: 52428800 },
            category: { type: 'string', minLength: 1 },
          },
        },
        Document: {
          type: 'object',
          required: [
            'id',
            'entityType',
            'entityId',
            'documentType',
            'filename',
            'mimeType',
            'sizeBytes',
            'status',
            'uploadedBy',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: { type: 'string' },
            entityType: { type: 'string' },
            entityId: { type: 'string' },
            documentType: { type: 'string' },
            filename: { type: 'string' },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['PENDING_UPLOAD', 'ACTIVE', 'ARCHIVED', 'PENDING_DELETION'],
            },
            uploadedBy: { type: 'string' },
            category: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DownloadUrlResponse: {
          type: 'object',
          required: ['data'],
          properties: {
            data: {
              type: 'object',
              required: ['downloadUrl', 'expiresInSeconds', 'variant'],
              properties: {
                downloadUrl: { type: 'string', format: 'uri' },
                expiresInSeconds: { type: 'integer' },
                variant: { type: 'string', enum: ['thumb', 'web', 'original'] },
                variantStatus: {
                  type: 'string',
                  enum: ['pending', 'unavailable'],
                  description:
                    'Present when the requested variant is not yet ready or permanently unavailable. The downloadUrl falls back to the original in these cases.',
                },
              },
            },
          },
        },
        VariantStatusMap: {
          type: 'object',
          required: ['thumb', 'web'],
          properties: {
            thumb: { type: 'string', enum: ['ready', 'pending', 'failed', 'none'] },
            web: { type: 'string', enum: ['ready', 'pending', 'failed', 'none'] },
          },
        },
        DocumentWithVariants: {
          allOf: [
            { $ref: '#/components/schemas/Document' },
            {
              type: 'object',
              required: ['variants'],
              properties: {
                variants: { $ref: '#/components/schemas/VariantStatusMap' },
              },
            },
          ],
        },
        ErrorResponse: {
          type: 'object',
          required: ['error', 'code'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            correlationId: { type: 'string' },
          },
        },
      },
      responses: {
        ValidationError: {
          description: 'Request body failed validation',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
    },
  } as const
}
