import Fastify, { FastifyBaseLogger, FastifyInstance, FastifyPluginCallback } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import requestContextPlugin from '@fastify/request-context';
import type { FastifyRequestContextOptions } from '@fastify/request-context';

import { env } from './config/env';
import { logger } from './logger';
import { closeDb } from './config/database';
import { redis, closeRedis } from './config/redis';

import { healthRoutes } from './routes/health.routes';
import { adminRoutes } from './routes/admin.routes';
import { proxyRoutes } from './routes/proxy.routes';

import { traceIdMiddleware } from './middlewares/trace-id.middleware';
import { authMiddleware } from './middlewares/auth.middleware';
import { rateLimitMiddleware } from './middlewares/rate-limit.middleware';
import { errorHandler } from './middlewares/error-handler.middleware';

import { loadConfig, startConfigReload, stopConfigReload } from './services/router/config-cache';

/**
 * Builds and configures the Fastify application.
 *
 * Separated from server.ts so tests can import `buildApp()` and call
 * `app.inject()` without binding to a TCP port.
 *
 * Middleware pipeline (execution order):
 *   request → [helmet] → [cors] → traceId → auth → rateLimit → handler
 *
 * Route registration order matters:
 *   health routes first (no auth/rate-limit)
 *   admin routes second (API-key protected)
 *   proxy catch-all last (/* wildcard)
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // pino.Logger satisfies FastifyBaseLogger; cast so TypeScript uses the right overload
    logger: logger as FastifyBaseLogger,
    // Trust X-Forwarded-For / X-Forwarded-Proto from Railway's L4 load balancer
    trustProxy: true,
    // Strict routing — /foo and /foo/ are different paths
    ignoreTrailingSlash: false,
    // 1 MB body limit (per-route can be overridden)
    bodyLimit: 1_048_576,
  });

  // ─── Global error handler ────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ─── OpenAPI / Swagger ─────────────────────────────────────────
  // Dynamic imports ensure @fastify/swagger and @fastify/swagger-ui (which
  // pulls in @fastify/static) are never loaded in test mode. Loading
  // @fastify/static even without registering it patches stream internals in
  // a way that causes light-my-request (inject()) to stall waiting for a
  // response-end event that never arrives.
  if (env.NODE_ENV !== 'test') {
  const { default: swagger } = await import('@fastify/swagger');
  const { default: swaggerUi } = await import('@fastify/swagger-ui');
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'TS API Gateway',
        version: '1.0.0',
        description: `
## Overview

A production-ready reverse proxy and API gateway built with **Fastify**, **PostgreSQL**, and **Redis**.

The gateway sits in front of your upstream services and provides:

| Feature | Details |
|---|---|
| **Dynamic routing** | Routes are stored in PostgreSQL and hot-reloaded into memory without restarts |
| **Auth enforcement** | Per-route JWT validation via JWKS (Auth0, Keycloak, or any OIDC provider) |
| **Rate limiting** | Redis sliding-window algorithm, keyed by user ID or client IP |
| **Circuit breaker** | Per-upstream Opossum breaker — opens after 50 % errors in 5 requests |
| **Observability** | Structured Pino logs, \`/metrics\` endpoint, \`X-Request-ID\` trace propagation |

## Request Pipeline

Every proxied request goes through this pipeline:

\`\`\`
Client → [helmet] → [cors] → traceId → auth → rateLimit → proxy handler → upstream
\`\`\`

## Authentication

Admin endpoints (\`/admin/*\`) require the \`x-api-key\` header matching the \`ADMIN_API_KEY\` env var.

Proxy routes with \`auth_required: true\` require a \`Bearer\` JWT in the \`Authorization\` header.
The gateway verifies the token signature via your JWKS endpoint (\`JWKS_URI\` env var) and checks
the \`aud\` and \`iss\` claims.

## Hot Reload

Every write to \`/admin/routes\` or \`/admin/policies\` bumps a \`config_versions\` counter in PostgreSQL.
All gateway instances poll this counter every \`CONFIG_RELOAD_INTERVAL_MS\` milliseconds and atomically
swap the in-memory routing table when a new version is detected — **zero downtime, no restarts needed**.
        `.trim(),
        contact: {
          name: 'API Gateway Docs',
          url: 'https://github.com/your-org/ts-api-gateway',
        },
        license: {
          name: 'MIT',
        },
      },
      tags: [
        {
          name: 'Admin: Routes',
          description:
            'Manage proxy route definitions. Each route maps an incoming path prefix to an upstream service. ' +
            'Changes take effect within `CONFIG_RELOAD_INTERVAL_MS` ms without restarting the gateway.',
        },
        {
          name: 'Admin: Policies',
          description:
            'Attach access-control policies to routes. A policy can require JWT authentication ' +
            'and/or enforce a per-route rate limit that overrides the global default.',
        },
        {
          name: 'Health',
          description:
            'Liveness and readiness probes. `/healthz` is used by Railway / Kubernetes as a liveness probe. ' +
            '`/readyz` checks PostgreSQL and Redis connectivity. `/metrics` returns an in-process snapshot.',
        },
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description:
              'Shared secret for admin endpoints. Set via the `ADMIN_API_KEY` environment variable. ' +
              'Use `dev-admin-key-123456` in local development (see `.env`).',
          },
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'RS256-signed JWT validated against your JWKS endpoint (`JWKS_URI`). ' +
              'Required only on proxy routes whose policy has `auth_required: true`.',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      defaultModelExpandDepth: 3,
      defaultModelsExpandDepth: 3,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
    staticCSP: false, // helmet already handles CSP globally
    transformSpecificationClone: true,
  });
  } // end if (env.NODE_ENV !== 'test')

  // ─── Security plugins ─────────────────────────────────────────
  await app.register(helmet, {
    // CSP disabled: the gateway proxies arbitrary upstream responses
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ─── Per-request context (AsyncLocalStorage) ──────────────────
  // Cast needed: @fastify/request-context uses `export =` which TypeScript cannot
  // directly match to FastifyPluginCallback without explicit narrowing.
  await app.register(
    requestContextPlugin as unknown as FastifyPluginCallback<FastifyRequestContextOptions>,
    {
      defaultStoreValues: {
        traceId: '' as string,
        userId: undefined as string | undefined,
      },
    },
  );

  // ─── Wildcard content-type parser ─────────────────────────────
  // Captures any content type that Fastify's built-in parsers don't handle
  // (e.g. application/octet-stream, multipart, XML) as a raw Buffer.
  // application/json is still handled by Fastify's native parser.
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // ─── Global middleware pipeline ────────────────────────────────
  // Hooks run in registration order for every request.
  app.addHook('preHandler', traceIdMiddleware);
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', rateLimitMiddleware);

  // ─── Route registration (ORDER MATTERS) ───────────────────────
  await app.register(healthRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(proxyRoutes); // catch-all — MUST be last

  // ─── Lifecycle hooks ──────────────────────────────────────────

  app.addHook('onReady', async () => {
    // Connect to Redis explicitly (lazyConnect: true in redis.ts)
    await redis.connect();
    logger.info('Redis connected');

    // Load routes + policies into memory cache from DB
    await loadConfig();

    // Start background polling for config version changes (hot reload)
    startConfigReload();

    logger.info({ port: env.PORT }, 'API Gateway ready');
  });

  app.addHook('onClose', async () => {
    stopConfigReload();
    await closeRedis();
    await closeDb();
    logger.info('Gateway shut down cleanly');
  });

  return app;
}
