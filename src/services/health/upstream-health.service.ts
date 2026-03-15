import { request as undiciRequest } from 'undici';
import { getConfig } from '../router/config-cache';
import { getAllBreakers } from '../proxy/circuit-breaker';
import { env } from '../../config/env';
import { logger } from '../../logger';

// ─── Types ────────────────────────────────────────────────────

export type UpstreamStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface UpstreamHealth {
  /** "host:port" key matching the circuit breaker registry */
  upstream: string;
  status: UpstreamStatus;
  /** Latency of the most recent health probe in milliseconds (null if never checked) */
  latencyMs: number | null;
  /** Total failed probes since the gateway started */
  consecutiveFailures: number;
  /** ISO-8601 timestamp of last probe (null if never run) */
  lastCheckedAt: string | null;
  /** Current circuit breaker state for this upstream */
  circuitBreaker: 'open' | 'half_open' | 'closed';
}

// ─── State ────────────────────────────────────────────────────

/**
 * In-memory registry keyed by "host:port".
 * Updated by the background health-check loop.
 */
const healthMap = new Map<string, UpstreamHealth>();
let healthTimer: NodeJS.Timeout | null = null;

// ─── Health probe ─────────────────────────────────────────────

/**
 * Sends a lightweight HEAD probe to an upstream.
 *
 * Why HEAD:
 *   - Most servers accept HEAD on any path they accept GET.
 *   - No response body is transferred, so the probe is cheap.
 *   - A 2xx, 3xx, or 4xx reply all confirm the server is reachable —
 *     only network errors / timeouts indicate genuine unavailability.
 */
async function probeUpstream(
  host: string,
  port: number,
): Promise<{ latencyMs: number; ok: boolean }> {
  const url = `http://${host}:${port}/`;
  const start = Date.now();
  try {
    const res = await undiciRequest(url, {
      method: 'HEAD',
      headersTimeout: env.UPSTREAM_HEALTH_TIMEOUT_MS,
      // A 4xx from the upstream is still "reachable" — it's just the root path
      throwOnError: false,
    });
    // Drain the (empty) body to release the socket
    await res.body.dump();
    return { latencyMs: Date.now() - start, ok: true };
  } catch {
    return { latencyMs: Date.now() - start, ok: false };
  }
}

/**
 * Maps probe results to a health status.
 * Thresholds are intentionally simple — replace with SLO-based rules for production.
 */
function statusFromProbe(ok: boolean, latencyMs: number, consecutive: number): UpstreamStatus {
  if (!ok) return consecutive >= 3 ? 'unhealthy' : 'degraded';
  if (latencyMs > 2000) return 'degraded';
  return 'healthy';
}

// ─── Background loop ──────────────────────────────────────────

/**
 * Runs a single health-check pass across all routes currently registered in
 * the config cache.  De-duplicates checks for routes sharing the same upstream.
 */
async function runHealthChecks(): Promise<void> {
  const { routes } = getConfig();
  const breakers = getAllBreakers();

  // Deduplicate: check each unique host:port once
  const checked = new Set<string>();

  for (const route of routes) {
    const key = `${route.upstreamHost}:${route.upstreamPort}`;
    if (checked.has(key)) continue;
    checked.add(key);

    const existing = healthMap.get(key) ?? {
      upstream: key,
      status: 'unknown' as UpstreamStatus,
      latencyMs: null,
      consecutiveFailures: 0,
      lastCheckedAt: null,
      circuitBreaker: 'closed' as const,
    };

    const { latencyMs, ok } = await probeUpstream(route.upstreamHost, route.upstreamPort);
    const consecutiveFailures = ok ? 0 : existing.consecutiveFailures + 1;
    const status = statusFromProbe(ok, latencyMs, consecutiveFailures);

    // Resolve circuit breaker state
    const breaker = breakers.get(key);
    let circuitBreaker: UpstreamHealth['circuitBreaker'] = 'closed';
    if (breaker?.opened)   circuitBreaker = 'open';
    if (breaker?.halfOpen) circuitBreaker = 'half_open';

    const entry: UpstreamHealth = {
      upstream: key,
      status,
      latencyMs,
      consecutiveFailures,
      lastCheckedAt: new Date().toISOString(),
      circuitBreaker,
    };

    healthMap.set(key, entry);

    if (status !== 'healthy') {
      logger.warn({ upstream: key, status, latencyMs, consecutiveFailures }, 'Upstream health degraded');
    }
  }
}

// ─── Public API ───────────────────────────────────────────────

/** Returns a snapshot of all upstream health entries. */
export function getAllUpstreamHealth(): UpstreamHealth[] {
  return Array.from(healthMap.values());
}

/** Returns the health entry for a specific upstream key (host:port). */
export function getUpstreamHealth(key: string): UpstreamHealth | undefined {
  return healthMap.get(key);
}

/**
 * Starts the background health-check loop.
 * Called from app.ts onReady hook.
 */
export function startHealthChecks(): void {
  if (!env.UPSTREAM_HEALTH_ENABLED) return;

  // Run an immediate check on startup, then on the configured interval
  runHealthChecks().catch((err) => logger.error(err, 'Initial upstream health check failed'));

  healthTimer = setInterval(() => {
    runHealthChecks().catch((err) => logger.error(err, 'Upstream health check failed'));
  }, env.UPSTREAM_HEALTH_CHECK_INTERVAL_MS);
}

/** Stops the health-check loop. Called from app.ts onClose hook. */
export function stopHealthChecks(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}
