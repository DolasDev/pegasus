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
