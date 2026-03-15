import { FastifyRequest, FastifyReply } from 'fastify';
import { matchRoute } from '../services/router/route-matcher';
import { getConfig } from '../services/router/config-cache';
import { buildCacheKey, getCached, setCached, CachedResponse } from '../services/cache/cache.service';
import { env } from '../config/env';

// ─── Headers whose values are worth preserving across cache hits ──
const CACHEABLE_RESPONSE_HEADERS = [
  'content-type',
  'content-encoding',
  'etag',
  'last-modified',
  'cache-control',
  'x-request-id',
];

// ─── Request conditions that bypass the cache ────────────────

function isCacheableMethod(method: string): boolean {
  // Only idempotent, side-effect-free methods produce cacheable responses
  return method === 'GET' || method === 'HEAD';
}

function hasBypassHeaders(req: FastifyRequest): boolean {
  const cc = req.headers['cache-control'];
  // Respect explicit client cache bypasses
  if (typeof cc === 'string' && (cc.includes('no-cache') || cc.includes('no-store'))) {
    return true;
  }
  // Per-user responses must never be shared across users
  if (req.headers['authorization']) return true;
  return false;
}

// ─── preHandler hook — serve from cache on HIT ───────────────

/**
 * Cache middleware — preHandler hook.
 *
 * On a cache HIT:
 *   - Sends the cached response immediately (short-circuits the proxy).
 *   - Sets `X-Cache: HIT` and `X-Cache-Age` headers.
 *
 * On a cache MISS:
 *   - Stores the cache key + TTL in requestContext for the onSend hook.
 *   - Sets `X-Cache: MISS`.
 *   - Allows the request to continue to the proxy handler.
 *
 * Cache is disabled when:
 *   - CACHE_ENABLED=false
 *   - Request is not GET or HEAD
 *   - Authorization header is present (user-specific response)
 *   - Client sends Cache-Control: no-cache / no-store
 *   - Route has no matching policy with cache_ttl_seconds (and no global default)
 */
export async function cacheMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!env.CACHE_ENABLED) return;
  if (!isCacheableMethod(req.method)) return;
  if (hasBypassHeaders(req)) return;

  const path = req.url.split('?')[0] ?? '/';

  // Skip internal paths — they are never proxied
  if (
    path === '/healthz' ||
    path === '/readyz' ||
    path === '/metrics' ||
    path.startsWith('/docs') ||
    path.startsWith('/admin')
  ) return;

  const { routes, policies } = getConfig();
  const match = matchRoute(path, routes);
  if (!match) return; // 404 handled by proxy

  const policy = policies.get(match.route.id);
  const ttl = policy?.cacheTtlSeconds ?? env.CACHE_DEFAULT_TTL_SECONDS;
  if (!ttl || ttl <= 0) return; // This route is not configured for caching

  const cacheKey = buildCacheKey(match.route.name, req.method, req.url);
  const cached = await getCached(cacheKey);

  if (cached) {
    // ── Cache HIT ───────────────────────────────────────────
    const ageSeconds = Math.floor((Date.now() - cached.cachedAt) / 1000);
    void reply.header('X-Cache', 'HIT');
    void reply.header('X-Cache-Age', String(ageSeconds));

    for (const [key, value] of Object.entries(cached.headers)) {
      void reply.header(key, value);
    }

    // Restore the original response body from base64
    const body = Buffer.from(cached.body, 'base64');
    void reply.status(cached.statusCode).send(body);
    return;
  }

  // ── Cache MISS — annotate request context for onSend hook ──
  req.requestContext.set('cacheKey', cacheKey);
  req.requestContext.set('cacheTtl', ttl);
  void reply.header('X-Cache', 'MISS');
}

// ─── onSend hook — populate cache on successful response ────

/**
 * Cache store hook — onSend hook.
 *
 * Populates the Redis cache when all conditions are met:
 *   - A cacheKey was set by cacheMiddleware (route is cacheable)
 *   - Upstream returned a 2xx status
 *   - Upstream does not prohibit caching (no Cache-Control: no-store)
 *
 * The payload is stored base64-encoded so binary responses are handled correctly.
 */
export async function cacheOnSend(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<void> {
  const cacheKey = req.requestContext.get('cacheKey');
  const cacheTtl = req.requestContext.get('cacheTtl');

  // Not a cacheable request — exit without touching the payload.
  // Fastify preserves the original payload when onSend returns void.
  if (!cacheKey || !cacheTtl) return;

  // Only cache successful responses
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;

  // Respect upstream Cache-Control: no-store directive
  const upstreamCc = reply.getHeader('cache-control');
  if (typeof upstreamCc === 'string' && upstreamCc.includes('no-store')) return;

  // Encode body to base64 so binary payloads are stored correctly
  let bodyBase64: string;
  if (Buffer.isBuffer(payload)) {
    bodyBase64 = payload.toString('base64');
  } else if (typeof payload === 'string') {
    bodyBase64 = Buffer.from(payload).toString('base64');
  } else {
    return; // Streams or other types — skip caching
  }

  // Collect selected response headers to restore on cache hit
  const headers: Record<string, string> = {};
  for (const header of CACHEABLE_RESPONSE_HEADERS) {
    const val = reply.getHeader(header);
    if (val !== undefined) headers[header] = String(val);
  }

  const entry: CachedResponse = {
    statusCode: reply.statusCode,
    headers,
    body: bodyBase64,
    cachedAt: Date.now(),
  };

  // setCached catches its own errors, so awaiting it never throws.
  // Returning void preserves the original payload (Fastify behaviour).
  await setCached(cacheKey, entry, cacheTtl);
}
