import { FastifyInstance } from 'fastify';
import { checkDbConnection } from '../config/database';
import { checkRedisConnection } from '../config/redis';
import { getConfig } from '../services/router/config-cache';
import { getMetrics } from '../services/metrics/metrics.service';

/**
 * Health and observability endpoints.
 *
 * GET /healthz — liveness probe (always 200 if the process is alive)
 * GET /readyz  — readiness probe (200 only if DB + Redis are reachable)
 * GET /metrics — internal metrics snapshot (JSON)
 *
 * Railway uses /healthz as the health check path (configured in railway.toml).
 * Kubernetes would use /healthz for liveness and /readyz for readiness.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness — is the process up?
  app.get('/healthz', {
    logLevel: 'silent',
    schema: {
      tags: ['Health'],
      summary: 'Liveness probe',
      description:
        'Returns `200 OK` as long as the Node.js process is running. ' +
        'Used by Railway / Kubernetes as a liveness probe — if this endpoint is unreachable, ' +
        'the container is restarted.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'], examples: ['ok'] },
          },
        },
      },
    },
  }, async (_req, reply) => {
    void reply.send({ status: 'ok' });
  });

  // Readiness — are dependencies reachable?
  app.get('/readyz', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness probe',
      description:
        'Returns `200 ready` only if PostgreSQL and Redis are both reachable and the routing config has been loaded. ' +
        'Returns `503 not_ready` if any dependency is down. ' +
        'Kubernetes should use this for readiness probes so the pod is removed from load balancer rotation during outages.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ready'], examples: ['ready'] },
            checks: {
              type: 'object',
              properties: {
                database: { type: 'string', enum: ['ok', 'failed'] },
                redis: { type: 'string', enum: ['ok', 'failed'] },
              },
            },
            config: {
              type: 'object',
              properties: {
                routes_loaded: {
                  type: 'integer',
                  description: 'Number of enabled routes currently in the in-memory cache.',
                  examples: [3],
                },
                config_version: {
                  type: 'integer',
                  description: 'Current config version number (incremented on every admin write).',
                  examples: [7],
                },
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['not_ready'] },
            checks: {
              type: 'object',
              properties: {
                database: { type: 'string', enum: ['ok', 'failed'] },
                redis: { type: 'string', enum: ['ok', 'failed'] },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      checkDbConnection(),
      checkRedisConnection(),
    ]);

    const { routes, version } = getConfig();

    const checks = {
      database: dbOk ? 'ok' : 'failed',
      redis: redisOk ? 'ok' : 'failed',
    };

    if (!dbOk || !redisOk) {
      void reply.status(503).send({ status: 'not_ready', checks });
      return;
    }

    void reply.send({
      status: 'ready',
      checks,
      config: {
        routes_loaded: routes.length,
        config_version: version,
      },
    });
  });

  // Metrics snapshot
  app.get('/metrics', {
    logLevel: 'silent',
    schema: {
      tags: ['Health'],
      summary: 'Metrics snapshot',
      description:
        'Returns an in-process JSON snapshot of gateway-level metrics. ' +
        'Data is accumulated in memory and reset on process restart — not a replacement for Prometheus/Datadog. ' +
        'Useful for quick health checks and debugging in production.',
      response: {
        200: {
          type: 'object',
          description: 'Gateway metrics snapshot.',
          properties: {
            uptime: {
              type: 'object',
              properties: {
                startedAt: { type: 'string', format: 'date-time' },
                uptimeSeconds: { type: 'number' },
              },
            },
            requests: {
              type: 'object',
              properties: {
                total: { type: 'integer', description: 'Total requests handled since startup.' },
                byStatusClass: {
                  type: 'object',
                  description: 'Request counts grouped by HTTP status class (2xx, 3xx, 4xx, 5xx).',
                  additionalProperties: { type: 'integer' },
                },
                byRoute: {
                  type: 'object',
                  description: 'Request counts grouped by route name.',
                  additionalProperties: { type: 'integer' },
                },
              },
            },
            latency: {
              type: 'object',
              properties: {
                p50Ms: { type: 'number', description: 'Median latency (ms) over the last 1000 requests.' },
                p95Ms: { type: 'number', description: '95th percentile latency (ms).' },
                p99Ms: { type: 'number', description: '99th percentile latency (ms).' },
                histogram: {
                  type: 'object',
                  description: 'Histogram bucket counts for latency distribution visualization.',
                  additionalProperties: { type: 'integer' },
                },
              },
            },
            circuitBreakers: {
              type: 'object',
              description: 'Current open/closed state of each upstream circuit breaker.',
              additionalProperties: { type: 'boolean' },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    void reply.send(getMetrics());
  });
}
