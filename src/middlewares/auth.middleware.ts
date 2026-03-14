import { FastifyRequest, FastifyReply } from 'fastify';
import { matchRoute } from '../services/router/route-matcher';
import { getConfig } from '../services/router/config-cache';
import { verifyToken } from '../services/auth/jwt.service';
import { logger } from '../logger';

/**
 * Auth middleware — runs after trace-ID injection, before rate limiting.
 *
 * Logic:
 *  1. Extract the request path and find the matching route.
 *  2. Look up the route's policy. If auth_required is false, pass through.
 *  3. Extract Bearer token from Authorization header.
 *  4. Validate the JWT via JWKS (cached).
 *  5. Store the user's `sub` claim in requestContext for downstream use
 *     (e.g. rate limiter uses it as the rate-limit key instead of IP).
 *
 * Skip paths:
 *  - /healthz and /readyz (no route match → pass through)
 *  - /admin/* (protected by API key, not JWT)
 */
export async function authMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const path = req.url.split('?')[0] ?? '/';

  // Skip admin, health, and docs routes — they are protected differently or public
  if (
    path.startsWith('/admin') ||
    path === '/healthz' ||
    path === '/readyz' ||
    path === '/metrics' ||
    path.startsWith('/docs')
  ) {
    return;
  }

  const { routes, policies } = getConfig();
  const match = matchRoute(path, routes);

  // No matching route → let the proxy handler return 404
  if (!match) return;

  const policy = policies.get(match.route.id);

  // Route exists but has no policy or auth is not required → pass through
  if (!policy?.authRequired) return;

  // Auth required — validate Bearer token
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    void reply.status(401).send({
      error: 'Unauthorized — Bearer token required',
      traceId: req.requestContext.get('traceId'),
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token);
    req.requestContext.set('userId', payload.sub);
  } catch (err) {
    logger.warn({ err }, 'JWT validation failed');
    void reply.status(401).send({
      error: 'Unauthorized — invalid or expired token',
      traceId: req.requestContext.get('traceId'),
    });
  }
}
