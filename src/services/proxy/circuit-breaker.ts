import CircuitBreaker from 'opossum';
import { proxyRequest, ProxyOptions, ProxyResult } from './http-proxy';
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
  const breaker = new CircuitBreaker(proxyRequest, {
    name: key,
    timeout: env.CIRCUIT_BREAKER_TIMEOUT_MS,
    errorThresholdPercentage: env.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT,
    resetTimeout: env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
    // Minimum number of requests before the error rate is evaluated
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
