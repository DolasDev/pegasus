// ---------------------------------------------------------------------------
// OpenAPI 3.1 spec — served as a static JSON document.
//
// The spec is hand-authored here to avoid a heavy code-generation dependency.
// It documents the public surface area incrementally; start with /health and
// the core /api/v1/customers resource and expand with each new handler.
// ---------------------------------------------------------------------------

export function getOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pegasus API',
      version: '1.0.0',
      description: 'Move management platform API',
    },
    paths: {
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
    },
    components: {
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
