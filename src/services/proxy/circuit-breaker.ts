import CircuitBreaker from 'opossum';
// upstreamRequest wraps proxyRequest with retry + per-attempt AbortSignal timeouts.
// The circuit breaker wraps upstreamRequest so it sees only final outcomes:
// transient errors that self-heal within the retry budget never count as failures.
import { upstreamRequest } from './upstream-client';
import { ProxyOptions, ProxyResult } from './http-proxy';
import { env } from '../../config/env';
import { logger } from '../../logger';
import { setCircuitBreakerState } from '../metrics/metrics.service';

type ProxyBreaker = CircuitBreaker<[ProxyOptions], ProxyResult>;

/**
 * Per-upstream circuit breaker registry.
 *
 * One breaker is created per unique upstream (host:port).
 * State transitions:
 *   CLOSED   → normal operation, requests pass through
 *   OPEN     → upstream considered unhealthy, requests fail-fast (503)
 *   HALF-OPEN → probe requests sent to test recovery
 *
 * Configuration (all from env):
 *   CIRCUIT_BREAKER_TIMEOUT_MS              — request timeout inside breaker
 *   CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT — % failures to open
 *   CIRCUIT_BREAKER_RESET_TIMEOUT_MS        — wait before probing
 */
const breakers = new Map<string, ProxyBreaker>();

function upstreamKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function createBreaker(key: string): ProxyBreaker {
  const breaker = new CircuitBreaker(upstreamRequest, {
    name: key,
    // opossum's own timeout is disabled — AbortSignal.timeout() inside upstream-client.ts
    // provides per-attempt deadlines that also integrate with the retry policy.
    timeout: false,
    errorThresholdPercentage: env.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT,
    resetTimeout: env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
    // Require at least 5 requests in the rolling window before evaluating error rate.
    // Prevents a cold-start spike from opening the circuit prematurely.
    volumeThreshold: 5,
  });

  breaker.on('open', () => {
    logger.warn({ upstream: key }, 'Circuit breaker OPEN — upstream failing');
    setCircuitBreakerState(key, true);
  });
  breaker.on('close', () => {
    logger.info({ upstream: key }, 'Circuit breaker CLOSED — upstream recovered');
    setCircuitBreakerState(key, false);
  });
  breaker.on('halfOpen', () => {
    logger.info({ upstream: key }, 'Circuit breaker HALF-OPEN — probing upstream');
  });
  breaker.on('failure', (err: unknown) => {
    logger.error(
      { upstream: key, err: err instanceof Error ? err.message : err },
      'Circuit breaker recorded upstream failure',
    );
  });

  return breaker;
}

/**
 * Returns the circuit breaker for a given upstream.
 * Creates one lazily on first use.
 */
export function getBreaker(host: string, port: number): ProxyBreaker {
  const key = upstreamKey(host, port);
  if (!breakers.has(key)) {
    breakers.set(key, createBreaker(key));
  }
  return breakers.get(key)!;
}

/** Returns all breakers — used by /metrics endpoint to report state. */
export function getAllBreakers(): Map<string, ProxyBreaker> {
  return breakers;
}
