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

// The operational `vnd_`-reachable GET surface (workflows / executions / triggers,
// pegII orders+tasks, secrets/config reads, projection cache + 0026 read-model,
// events, blobs, integration reads, legacy orders). Enforced complete by
// lib/openapi-spec.coverage.test.ts. `q` = the ?query= param the SDK's api_get can pass.
const OPERATIONAL_READ_PATHS: Record<string, { get: Record<string, unknown> }> = {
  '/api/v1/workflows': apiKeyGet(
    'listWorkflows',
    'List workflows visible to the tenant (∪ GLOBAL)',
    {
      tags: ['Workflows'],
      responseDescription: '{data: WorkflowResponse[]}',
    },
  ),
  '/api/v1/workflows/{id}': apiKeyGet('getWorkflow', 'Get a workflow by id', {
    tags: ['Workflows'],
    path: ['id'],
  }),
  '/api/v1/workflows/{id}/download-url': apiKeyGet(
    'getWorkflowDownloadUrl',
    'Presigned URL for a workflow artifact (ReadWorkflow)',
    { tags: ['Workflows'], path: ['id'] },
  ),
  '/api/v1/workflows/{id}/triggers': apiKeyGet(
    'listTriggers',
    "List a workflow's SCHEDULE + EVENT triggers (ReadWorkflow)",
    { tags: ['Workflows'], path: ['id'] },
  ),
  '/api/v1/workflows/{id}/executions': apiKeyGet(
    'listExecutions',
    "List a workflow's executions, newest first (ReadWorkflow)",
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
  '/api/v1/pegii/orders': apiKeyGet('listPegiiOrders', 'List pegII orders (ReadOrder)', {
    tags: ['pegII'],
  }),
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
    query: [{ name: 'active', description: 'filter by active state' }],
  }),
  '/api/v1/pegii/salesmen/{salesmanId}': apiKeyGet(
    'getPegiiSalesman',
    'Get a pegII salesman (ReadSalesman)',
    { tags: ['pegII'], path: ['salesmanId'] },
  ),
  '/api/v1/pegii/tasks': apiKeyGet('listPegiiTasks', 'List pegII tasks (ReadTask)', {
    tags: ['pegII'],
  }),
  '/api/v1/pegii/tasks/{taskId}': apiKeyGet('getPegiiTask', 'Get a pegII task (ReadTask)', {
    tags: ['pegII'],
    path: ['taskId'],
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

export function getOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pegasus API',
      version: '1.0.0',
      description:
        'The SDK-facing (vnd_ / m2m) Pegasus API surface — the endpoints a PegasusClient key can call, including the operational read surface reachable via api_get. Cognito-only browser routes and worker-internal (broker-secret) endpoints are intentionally excluded.',
    },
    paths: {
      ...OPERATIONAL_READ_PATHS,
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
          responses: { '201': { description: 'New execution started ({data: execution})' } },
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
            'Body: { title, definition: { questions: [...] }, messageTemplate? }. The definition is validated as a supported question-list subset; a publish supersedes the prior published version for the key.',
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
            'Each floor is a per-type, partner-neutral contract. Returns each floor id + its canonicalFields (legal mapping targets) + factCatalog (legal rule facts) + inputFieldRoots (legal mapping source roots, when declared) + defaultAction + projection.',
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
            'The contract an author writes a config AGAINST: `canonicalFields` are the only legal mapping targets; `factCatalog` are the only legal rule facts; `inputFieldRoots` (when present) are the legal mapping SOURCE roots a `$from` may read — a bare entry opens a whole native root, a dotted entry opens only that curated sub-path.',
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
                          factCatalog: {
                            type: 'object',
                            additionalProperties: { enum: ['string', 'number', 'boolean'] },
                          },
                          inputFieldRoots: { type: 'array', items: { type: 'string' } },
                          defaultAction: { type: 'string' },
                          projection: {
                            type: 'object',
                            properties: { entityType: { type: 'string' } },
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
