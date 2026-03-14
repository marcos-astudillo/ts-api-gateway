/**
 * JSON Schema definitions for the /admin/routes endpoints.
 *
 * These are used as Fastify route `schema` options and are picked up
 * automatically by @fastify/swagger to generate the OpenAPI spec.
 */
import { errorResponse, validationErrorResponse, uuidParam } from './common.schema';

// ─── Route object (response shape from DB) ───────────────────────────────────

const routeObject = {
  type: 'object',
  description: 'A registered proxy route.',
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Auto-generated UUID.' },
    name: {
      type: 'string',
      description: 'Unique route identifier used as a human-readable key.',
      examples: ['users-service'],
    },
    pathPrefix: {
      type: 'string',
      description: 'Incoming path prefix. Longest-match wins.',
      examples: ['/api/users'],
    },
    upstreamHost: {
      type: 'string',
      description: 'Upstream hostname (no scheme).',
      examples: ['users-service.internal'],
    },
    upstreamPort: {
      type: 'integer',
      minimum: 1,
      maximum: 65535,
      examples: [3001],
    },
    stripPath: {
      type: 'boolean',
      description: 'Whether the path prefix is stripped before forwarding.',
      examples: [false],
    },
    connectTimeoutMs: {
      type: 'integer',
      description: 'TCP connection timeout in milliseconds.',
      examples: [500],
    },
    requestTimeoutMs: {
      type: 'integer',
      description: 'Total request timeout in milliseconds.',
      examples: [5000],
    },
    retries: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      description: 'Retry attempts on upstream failure.',
      examples: [2],
    },
    enabled: {
      type: 'boolean',
      description: 'Disabled routes are excluded from the live config without being deleted.',
      examples: [true],
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

// ─── Request bodies ───────────────────────────────────────────────────────────

const createRouteBody = {
  type: 'object',
  required: ['name', 'match', 'upstream'],
  description: 'Configuration for a new proxy route.',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      pattern: '^[a-z0-9-_]+$',
      description:
        'Unique route name. Lowercase alphanumeric characters, hyphens (-) and underscores (_) only. ' +
        'Used as the rate-limit key prefix and in metrics labels.',
      examples: ['users-service'],
    },
    match: {
      type: 'object',
      required: ['path_prefix'],
      description: 'Incoming request matching rules.',
      properties: {
        path_prefix: {
          type: 'string',
          description:
            'All requests whose URL path starts with this prefix are forwarded to the upstream. ' +
            'When two routes overlap (e.g. `/api` and `/api/users`), the longest prefix wins. ' +
            'A trailing slash is treated as a distinct path from its bare counterpart.',
          examples: ['/api/users'],
        },
      },
    },
    upstream: {
      type: 'object',
      required: ['host', 'port'],
      description: 'Upstream service address.',
      properties: {
        host: {
          type: 'string',
          description: 'Hostname or IP of the upstream service — no `http://` scheme, no trailing slash.',
          examples: ['users-service.internal', '127.0.0.1'],
        },
        port: {
          type: 'integer',
          minimum: 1,
          maximum: 65535,
          description: 'TCP port the upstream is listening on.',
          examples: [3001, 8080],
        },
      },
    },
    strip_path: {
      type: 'boolean',
      default: false,
      description:
        'When `true`, the matching prefix is stripped from the URL before forwarding. ' +
        'Example: `GET /api/users/42` with prefix `/api/users` becomes `GET /42` upstream.',
    },
    timeouts_ms: {
      type: 'object',
      description: 'Per-route timeout overrides.',
      properties: {
        connect: {
          type: 'integer',
          minimum: 1,
          maximum: 30000,
          description: 'TCP connection timeout in milliseconds. Default: 500.',
          examples: [500],
        },
        request: {
          type: 'integer',
          minimum: 1,
          maximum: 60000,
          description: 'Total request timeout in milliseconds (connection + headers + body). Default: 5000.',
          examples: [5000],
        },
      },
    },
    retries: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      default: 0,
      description:
        'How many times to retry on upstream failure. Only retried for idempotent methods (GET, HEAD, PUT, DELETE). Default: 0.',
      examples: [2],
    },
  },
  examples: [
    {
      name: 'users-service',
      match: { path_prefix: '/api/users' },
      upstream: { host: 'users-service.internal', port: 3001 },
      strip_path: false,
      timeouts_ms: { connect: 500, request: 5000 },
      retries: 2,
    },
    {
      name: 'public-posts',
      match: { path_prefix: '/posts' },
      upstream: { host: 'posts-service.internal', port: 4000 },
      strip_path: true,
    },
  ],
};

const updateRouteBody = {
  type: 'object',
  description:
    'Partial update — only send fields you want to change. All fields are optional. ' +
    'Each successful update increments the config version, triggering a hot reload within ' +
    '`CONFIG_RELOAD_INTERVAL_MS` milliseconds on every gateway instance.',
  properties: {
    ...createRouteBody.properties,
    enabled: {
      type: 'boolean',
      description:
        'Set to `false` to soft-disable the route without deleting it. ' +
        'Disabled routes are excluded from traffic immediately after the next hot reload.',
    },
  },
  examples: [
    { upstream: { host: 'users-service-v2.internal', port: 3001 } },
    { enabled: false },
    { timeouts_ms: { connect: 2000, request: 10000 }, retries: 3 },
    { strip_path: true },
  ],
};

// ─── Response envelopes ───────────────────────────────────────────────────────

const listRoutesResponse = {
  type: 'object',
  properties: {
    data: { type: 'array', items: routeObject },
    count: { type: 'integer', description: 'Total number of routes (including disabled ones).' },
  },
};

const singleRouteResponse = {
  type: 'object',
  properties: {
    data: {
      ...routeObject,
      properties: {
        ...routeObject.properties,
        policy: {
          description: 'Attached access policy, or null if none has been set.',
          oneOf: [
            {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                authRequired: { type: 'boolean' },
                rateLimitRps: { type: ['integer', 'null'] },
                rateLimitBurst: { type: ['integer', 'null'] },
              },
            },
            { type: 'null' },
          ],
        },
      },
    },
  },
};

const createdRouteResponse = {
  type: 'object',
  properties: { data: routeObject },
};

// ─── Exported schema sets used in admin.routes.ts ─────────────────────────────

export const RouteSchemas = {
  // params
  uuidParam,
  // bodies
  createRouteBody,
  updateRouteBody,
  // responses
  listRoutesResponse,
  singleRouteResponse,
  createdRouteResponse,
  // shared errors
  errorResponse,
  validationErrorResponse,
};
