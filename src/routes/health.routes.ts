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
  app.get('/healthz', { logLevel: 'silent' }, async (_req, reply) => {
    void reply.send({ status: 'ok' });
  });

  // Readiness — are dependencies reachable?
  app.get('/readyz', async (_req, reply) => {
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
  app.get('/metrics', { logLevel: 'silent' }, async (_req, reply) => {
    void reply.send(getMetrics());
  });
}
