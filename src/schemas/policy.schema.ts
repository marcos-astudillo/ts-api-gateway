/**
 * JSON Schema definitions for the /admin/policies endpoints.
 */
import { errorResponse, validationErrorResponse, uuidParam } from './common.schema';

// ─── Policy object (response shape from DB) ───────────────────────────────────

const policyObject = {
  type: 'object',
  description:
    'An access control policy attached to a route. ' +
    'Controls JWT authentication and per-route rate limiting.',
  properties: {
    id: { type: 'string', format: 'uuid' },
    routeId: {
      type: 'string',
      format: 'uuid',
      description: 'The route this policy is attached to.',
    },
    authRequired: {
      type: 'boolean',
      description:
        'When `true`, the gateway validates a Bearer JWT on every request to this route. ' +
        'Unauthenticated requests receive `401 Unauthorized`.',
      examples: [false],
    },
    rateLimitRps: {
      type: ['integer', 'null'],
      description:
        'Maximum requests per second allowed per client (userId for authenticated users, IP for anonymous). ' +
        'Overrides the global `RATE_LIMIT_DEFAULT_RPS` for this route. `null` means use the global default.',
      examples: [50],
    },
    rateLimitBurst: {
      type: ['integer', 'null'],
      description:
        'Burst allowance — the maximum number of requests in the sliding window before the rate limit kicks in. ' +
        'Should be ≥ `rateLimitRps`. `null` means use the global default.',
      examples: [100],
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

// ─── Request body ─────────────────────────────────────────────────────────────

const createPolicyBody = {
  type: 'object',
  required: ['route'],
  description:
    'Create or replace the policy for a route. If a policy already exists for the route it is updated (upsert).',
  properties: {
    route: {
      type: 'string',
      description: 'The `name` of the route to attach this policy to.',
      examples: ['users-service'],
    },
    auth_required: {
      type: 'boolean',
      default: false,
      description:
        'Require a valid Bearer JWT. The gateway validates the token signature against your JWKS endpoint ' +
        '(`JWKS_URI`) and checks the `aud` / `iss` claims before forwarding the request.',
    },
    rate_limit: {
      type: 'object',
      description: 'Per-route rate limiting, applied on top of global defaults.',
      required: ['rps', 'burst'],
      properties: {
        rps: {
          type: 'integer',
          minimum: 1,
          description: 'Requests per second per client.',
          examples: [50],
        },
        burst: {
          type: 'integer',
          minimum: 1,
          description: 'Sliding-window burst cap. Must be ≥ `rps`.',
          examples: [100],
        },
      },
    },
  },
  examples: [
    // Public route — rate limit only
    {
      route: 'public-posts',
      rate_limit: { rps: 200, burst: 400 },
    },
    // Protected route — auth + tighter rate limit
    {
      route: 'users-service',
      auth_required: true,
      rate_limit: { rps: 50, burst: 100 },
    },
    // Auth only, no custom rate limit (uses global defaults)
    {
      route: 'admin-dashboard',
      auth_required: true,
    },
  ],
};

// ─── Response envelopes ───────────────────────────────────────────────────────

const listPoliciesResponse = {
  type: 'object',
  properties: {
    data: { type: 'array', items: policyObject },
    count: { type: 'integer' },
  },
};

const createdPolicyResponse = {
  type: 'object',
  properties: { data: policyObject },
};

// ─── Exported schema sets used in admin.routes.ts ─────────────────────────────

export const PolicySchemas = {
  uuidParam,
  createPolicyBody,
  listPoliciesResponse,
  createdPolicyResponse,
  errorResponse,
  validationErrorResponse,
};
