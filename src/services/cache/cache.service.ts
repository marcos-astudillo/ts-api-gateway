import { redis } from '../../config/redis';
import { logger } from '../../logger';

// ─── Types ────────────────────────────────────────────────────

/**
 * Shape stored in Redis for every cached upstream response.
 * The body is base64-encoded so any content type (binary, JSON, etc.) is safe.
 */
export interface CachedResponse {
  statusCode: number;
  /** Selected response headers (content-type, etag, last-modified, etc.) */
  headers: Record<string, string>;
  /** Base64-encoded response body */
  body: string;
  /** Unix epoch ms when the entry was cached (used for X-Cache-Age) */
  cachedAt: number;
}

// ─── Key construction ─────────────────────────────────────────

const KEY_PREFIX = 'gw:cache:';

/**
 * Builds a deterministic Redis key for a cacheable request.
 * Keys include the route name to avoid collisions when two routes share a path prefix.
 */
export function buildCacheKey(routeName: string, method: string, url: string): string {
  // Normalise query string order to improve hit rate
  const [path, qs = ''] = url.split('?');
  const sortedQs = qs
    .split('&')
    .filter(Boolean)
    .sort()
    .join('&');
  const normalised = sortedQs ? `${path}?${sortedQs}` : path;
  return `${KEY_PREFIX}${routeName}:${method}:${normalised}`;
}

// ─── Redis operations ─────────────────────────────────────────

/**
 * Retrieves a cached response from Redis.
 * Returns null on miss or on any Redis error (fail-open: let request through).
 */
export async function getCached(key: string): Promise<CachedResponse | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedResponse;
  } catch (err) {
    logger.warn({ key, err }, 'Cache GET failed — treating as miss');
    return null;
  }
}

/**
 * Stores a response in Redis with the given TTL.
 * Silently swallows errors — a cache write failure must never break the request.
 */
export async function setCached(
  key: string,
  response: CachedResponse,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(response), 'EX', ttlSeconds);
    logger.debug({ key, ttlSeconds, statusCode: response.statusCode }, 'Response cached');
  } catch (err) {
    logger.warn({ key, err }, 'Cache SET failed — response not cached');
  }
}

/**
 * Removes all cache entries for a given route.
 * Called when a route is updated or deleted via the Admin API (cache invalidation).
 */
export async function invalidateRoute(routeName: string): Promise<void> {
  try {
    const pattern = `${KEY_PREFIX}${routeName}:*`;
    // Use SCAN to avoid blocking Redis on large key sets
    let cursor = '0';
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');

    if (deleted > 0) {
      logger.info({ routeName, deleted }, 'Cache entries invalidated');
    }
  } catch (err) {
    logger.warn({ routeName, err }, 'Cache invalidation failed');
  }
}
