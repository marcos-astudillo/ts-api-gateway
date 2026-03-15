import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { matchRoute } from '../services/router/route-matcher';
import { getConfig } from '../services/router/config-cache';
import { getBreaker } from '../services/proxy/circuit-breaker';
import { recordRequest } from '../services/metrics/metrics.service';
import { logger } from '../logger';

/**
 * Catch-all proxy route — must be registered LAST in app.ts.
 *
 * Request pipeline (hooks run before this handler):
 *   1. traceIdMiddleware  → sets X-Request-ID
 *   2. authMiddleware     → validates JWT if route policy requires it
 *   3. rateLimitMiddleware → enforces Redis sliding-window rate limit
 *   4. ↓ this handler
 *      a. route matching
 *      b. body extraction
 *      c. circuit-breaker → retry policy → undici proxy
 *      d. metrics recording
 */
// @fastify/cors already handles OPTIONS /* for CORS preflight.
// We proxy every other standard HTTP method.
const PROXY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

export const proxyRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const traceId = req.requestContext.get('traceId') ?? '';
    const rawUrl = req.url;
    const qIdx = rawUrl.indexOf('?');
    const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const queryString = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);

    const { routes } = getConfig();
    const match = matchRoute(path, routes);

    if (!match) {
      void reply.status(404).send({
        error: 'No matching route',
        path,
        hint: 'Register a route via POST /admin/routes',
        traceId,
      });
      return;
    }

    const { route, upstreamPath } = match;
    const breaker = getBreaker(route.upstreamHost, route.upstreamPort);

    // Extract body as Buffer.
    // Fastify parses application/json into an object — re-serialize it.
    // Other types arrive as Buffer via the '*' content-type parser in app.ts.
    let body: Buffer | undefined;
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (typeof req.body === 'object') {
        body = Buffer.from(JSON.stringify(req.body));
      } else if (typeof req.body === 'string') {
        body = Buffer.from(req.body);
      }
    }

    const start = Date.now();

    try {
      const result = await breaker.fire({
        route,
        upstreamPath,
        method: req.method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        traceId,
        queryString,
      });

      const latencyMs = Date.now() - start;
      recordRequest(route.name, result.statusCode, latencyMs);

      // Forward upstream response headers (skip transfer-encoding — undici handles it)
      for (const [key, value] of Object.entries(result.headers)) {
        if (key.toLowerCase() !== 'transfer-encoding') {
          void reply.header(key, value as string);
        }
      }

      void reply.status(result.statusCode).send(result.body);
    } catch (err) {
      const latencyMs = Date.now() - start;
      const error = err as Error;

      logger.error(
        { path, route: route.name, latencyMs, err },
        'Proxy request failed',
      );

      // Circuit open counts as 503, everything else as 502 for metrics
      const metricsCode = error.message?.includes('Breaker is open') ? 503 : 502;
      recordRequest(route.name, metricsCode, latencyMs);

      // Circuit open — breaker is protecting against a failing upstream
      if (error.message?.includes('Breaker is open')) {
        void reply.status(503).send({
          error: 'upstream_unavailable',
          message: 'Service temporarily unavailable',
          traceId,
        });
        return;
      }

      // AbortSignal.timeout() fires TimeoutError; undici header timeout fires AbortError or
      // UND_ERR_HEADERS_TIMEOUT. Treat all as a gateway-side timeout (504).
      if (
        error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        error.message?.includes('UND_ERR_HEADERS_TIMEOUT') ||
        error.message?.includes('UND_ERR_BODY_TIMEOUT')
      ) {
        void reply.status(504).send({
          error: 'upstream_timeout',
          message: 'Upstream did not respond in time',
          traceId,
        });
        return;
      }

      void reply.status(502).send({
        error: 'upstream_error',
        message: 'Bad gateway',
        traceId,
      });
    }
  };

  for (const method of PROXY_METHODS) {
    app.route({ method, url: '/*', handler });
  }
  done();
};
