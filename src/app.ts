import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import requestContextPlugin from '@fastify/request-context';

import { env } from './config/env';
import { logger } from './logger';
import { db } from './config/database';
import { redis } from './config/redis';

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
    loggerInstance: logger,
    // Trust X-Forwarded-For / X-Forwarded-Proto from Railway's L4 load balancer
    trustProxy: true,
    // Strict routing — /foo and /foo/ are different paths
    ignoreTrailingSlash: false,
    // 1 MB body limit (per-route can be overridden)
    bodyLimit: 1_048_576,
  });

  // ─── Global error handler ────────────────────────────────────
  app.setErrorHandler(errorHandler);

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
  await app.register(requestContextPlugin, {
    defaultStoreValues: {
      traceId: '' as string,
      userId: undefined as string | undefined,
    },
  });

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
    await redis.quit();
    await db.end();
    logger.info('Gateway shut down cleanly');
  });

  return app;
}
