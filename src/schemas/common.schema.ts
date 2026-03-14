/**
 * Shared JSON Schema fragments reused across all OpenAPI route definitions.
 *
 * Why plain objects instead of Zod?
 * Fastify's route `schema` option expects JSON Schema 7 / OpenAPI 3 objects.
 * We keep Zod for runtime request validation in controllers and use these
 * schemas purely for documentation generation.
 */

// ─── Parameters ──────────────────────────────────────────────────────────────

export const uuidParam = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'Resource UUID (v4)',
      examples: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    },
  },
  required: ['id'],
} as const;

// ─── Error responses ──────────────────────────────────────────────────────────

/** Generic error envelope — used for 401, 403, 404, 409, 502, 503, 504. */
export const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'string',
      description: 'Human-readable error message.',
      examples: ['Route not found'],
    },
    traceId: {
      type: 'string',
      format: 'uuid',
      description: 'Propagated X-Request-ID for distributed tracing.',
      examples: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    },
  },
  required: ['error'],
} as const;

/** Validation error — returned by controllers when Zod parsing fails. */
export const validationErrorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'string',
      examples: ['Validation failed'],
    },
    details: {
      type: 'object',
      description:
        'Zod flatten() output containing `fieldErrors` (per-field messages) and `formErrors` (top-level messages).',
      properties: {
        fieldErrors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
        formErrors: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['error'],
} as const;

/** Rate-limit exceeded. */
export const rateLimitResponse = {
  type: 'object',
  properties: {
    error: { type: 'string', examples: ['Too Many Requests'] },
    retryAfterSeconds: {
      type: 'integer',
      description: 'Seconds to wait before retrying.',
      examples: [5],
    },
    traceId: { type: 'string', format: 'uuid' },
  },
  required: ['error', 'retryAfterSeconds'],
} as const;
