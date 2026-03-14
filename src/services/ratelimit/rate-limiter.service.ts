import { redis } from '../../config/redis';
import { logger } from '../../logger';

// ─── Types ────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  limit: number;
}

// ─── Lua script ───────────────────────────────────────────────
/**
 * Atomic sliding-window counter using Redis sorted sets.
 *
 * Algorithm:
 *  1. Remove entries older than `windowMs` ago (they've expired).
 *  2. Count entries remaining in the current window.
 *  3. If count < limit: add the current timestamp and allow.
 *  4. If count >= limit: reject.
 *
 * All operations are in a single Lua script so the check-and-add
 * is atomic — no TOCTOU race condition.
 *
 * Design note (from spec): "Global rate limiting requires coordination (Redis)"
 * This implementation is per-gateway-instance by default. For true global
 * limits across instances, all instances share the same Redis cluster —
 * which they do in this architecture (single Redis URL in env).
 */
const SLIDING_WINDOW_SCRIPT = `
local key     = KEYS[1]
local now     = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local limit   = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1}
else
  return {0, 0}
end
`;

// ─── Public API ───────────────────────────────────────────────

/**
 * Checks and records a rate-limit hit for a given route + client.
 *
 * @param routeName  The matched route name (used as part of the Redis key).
 * @param clientId   User ID (if authenticated) or client IP address.
 * @param rps        Requests allowed per second.
 * @param burst      Max requests allowed in the window (burst > rps allows short spikes).
 */
export async function checkRateLimit(
  routeName: string,
  clientId: string,
  _rps: number,
  burst: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = 1000; // 1 second sliding window
  const key = `rl:${routeName}:${clientId}`;
  const limit = burst; // burst controls the window cap; _rps is reserved for future token-bucket mode

  try {
    const result = (await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now,
      windowMs,
      limit,
    )) as [number, number];

    const [allowed, remaining] = result;

    return {
      allowed: allowed === 1,
      remaining: Math.max(0, remaining),
      resetAtMs: now + windowMs,
      limit,
    };
  } catch (err) {
    // Fail-open: if Redis is unavailable, allow the request rather than
    // taking the service down. Log the error so operators are alerted.
    logger.error(err, 'Rate limiter Redis error — failing open');
    return { allowed: true, remaining: limit, resetAtMs: now + windowMs, limit };
  }
}
