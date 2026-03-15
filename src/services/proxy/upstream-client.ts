import { proxyRequest, ProxyOptions, ProxyResult } from './http-proxy';
import { executeWithRetry, isRetryableStatus } from './retry-policy';
import { logger } from '../../logger';

/**
 * Executes an upstream HTTP request with automatic retry and per-attempt timeouts.
 *
 * This is the function wrapped by the opossum circuit breaker in circuit-breaker.ts.
 * Placing retry logic here — *inside* the breaker — means:
 *
 *  - The breaker counts only exhausted failures, not individual transient attempts.
 *    A flapping upstream that recovers within the retry budget never opens the circuit.
 *  - Persistent failures (all retries exhausted) do count against the breaker threshold.
 *
 * Timeout strategy:
 *  - Each individual attempt gets a fresh AbortSignal.timeout(route.requestTimeoutMs).
 *    This is a hard wall-clock limit from request start to final response byte.
 *  - undici's headersTimeout (set to route.connectTimeoutMs in http-proxy.ts) remains
 *    as the connection-phase guard.
 *  - Using a fresh signal per attempt ensures a timed-out first attempt does not
 *    bleed into the second attempt's deadline.
 *
 * Retry budget: route.retries (default 2, stored per-route in PostgreSQL).
 */
export async function upstreamRequest(options: ProxyOptions): Promise<ProxyResult> {
  const { route } = options;
  const maxRetries = route.retries ?? 2;

  return executeWithRetry(
    // Create a fresh AbortSignal for every attempt so each has its own deadline
    () => proxyRequest({ ...options, signal: AbortSignal.timeout(route.requestTimeoutMs) }),

    // Retry on 5xx — indicates transient upstream overload or rolling restart
    (result) => isRetryableStatus(result.statusCode),

    {
      maxRetries,
      onRetry: (attempt, err) => {
        logger.warn(
          {
            upstream: `${route.upstreamHost}:${route.upstreamPort}`,
            route: route.name,
            attempt,
            maxRetries,
            // Only log the error message — full stack is noise for expected retries
            reason: err instanceof Error ? err.message : 'retryable status',
          },
          'Upstream request failed — retrying',
        );
      },
    },
  );
}
