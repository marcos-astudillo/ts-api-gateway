import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { requestContext } from '@fastify/request-context';
import { env } from './config/env';
import { logger } from './logger';

/**
 * Creates and configures the Fastify application.
 * Separated from server.ts so tests can import the app without binding to a port.
 */
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    // Trust X-Forwarded-For from load balancer (Railway / any L4 LB)
    trustProxy: true,
    // Strict routing: /foo and /foo/ are different routes
    ignoreTrailingSlash: false,
    // Return 413 for bodies > 1mb (configurable per route if needed)
    bodyLimit: 1_048_576,
  });

  // ─── Security headers ─────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // Gateway proxies arbitrary content
  });

  // ─── CORS ─────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ─── Request context (trace ID, auth context, etc.) ───────────
  await app.register(requestContext, {
    defaultStoreValues: {
      traceId: '',
      userId: undefined as string | undefined,
    },
  });

  // ─── Health endpoints ─────────────────────────────────────────
  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }));
  app.get('/readyz', { logLevel: 'silent' }, async () => ({ status: 'ok' }));

  // ─── Routes registered later by phase ─────────────────────────
  // Phase 2: app.register(adminRoutes, { prefix: '/admin' })
  // Phase 3: app.register(proxyRoutes)

  return app;
}
