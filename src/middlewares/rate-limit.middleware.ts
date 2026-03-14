import { FastifyRequest, FastifyReply } from 'fastify';
import { matchRoute } from '../services/router/route-matcher';
import { getConfig } from '../services/router/config-cache';
import { checkRateLimit } from '../services/ratelimit/rate-limiter.service';
import { env } from '../config/env';

/**
 * Rate-limit middleware — runs after auth, before the proxy handler.
 *
 * Key selection strategy (most-specific wins):
 *  - Authenticated users  → keyed by userId (fair per-user limits)
 *  - Anonymous requests   → keyed by client IP (best-effort)
 *
 * Limit values (in priority order):
 *  1. Route policy: rate_limit_rps / rate_limit_burst  (per-route override)
 *  2. Environment defaults: RATE_LIMIT_DEFAULT_RPS / RATE_LIMIT_DEFAULT_BURST
 *
 * Response headers follow the IETF draft standard:
 *   X-RateLimit-Limit     — window cap
 *   X-RateLimit-Remaining — tokens left in current window
 *   X-RateLimit-Reset     — window reset timestamp (Unix ms)
 */
export async function rateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!env.RATE_LIMIT_ENABLED) return;

  const path = req.url.split('?')[0] ?? '/';

  // Skip internal and docs routes
  if (
    path === '/healthz' ||
    path === '/readyz' ||
    path === '/metrics' ||
    path.startsWith('/docs')
  ) return;

  const { routes, policies } = getConfig();
  const match = matchRoute(path, routes);
  if (!match) return; // 404 handled by proxy

  const policy = policies.get(match.route.id);
  const rps = policy?.rateLimitRps ?? env.RATE_LIMIT_DEFAULT_RPS;
  const burst = policy?.rateLimitBurst ?? env.RATE_LIMIT_DEFAULT_BURST;

  // Use authenticated userId if available (set by authMiddleware), else fall back to IP
  const userId = req.requestContext.get('userId');
  const clientId = userId ?? req.ip ?? 'unknown';

  const result = await checkRateLimit(match.route.name, clientId, rps, burst);

  // Set rate limit headers regardless of allow/deny
  void reply.header('X-RateLimit-Limit', result.limit);
  void reply.header('X-RateLimit-Remaining', result.remaining);
  void reply.header('X-RateLimit-Reset', result.resetAtMs);

  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil((result.resetAtMs - Date.now()) / 1000);
    void reply.header('Retry-After', retryAfterSeconds);
    void reply.status(429).send({
      error: 'Too Many Requests',
      retryAfterSeconds,
      traceId: req.requestContext.get('traceId'),
    });
  }
}
