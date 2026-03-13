import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRequest,
  setCircuitBreakerState,
  getMetrics,
  resetMetrics,
} from '../../src/services/metrics/metrics.service';

describe('MetricsService', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('starts with zero requests', () => {
    const m = getMetrics();
    expect((m['requests'] as { total: number }).total).toBe(0);
  });

  it('increments total request count', () => {
    recordRequest('orders', 200, 10);
    recordRequest('orders', 200, 15);
    recordRequest('users', 404, 5);

    const m = getMetrics();
    expect((m['requests'] as { total: number }).total).toBe(3);
  });

  it('groups counts by status class', () => {
    recordRequest('orders', 200, 10);
    recordRequest('orders', 201, 20);
    recordRequest('orders', 500, 100);
    recordRequest('orders', 404, 5);

    const m = getMetrics();
    const byStatus = (m['requests'] as { byStatusClass: Record<string, number> }).byStatusClass;
    expect(byStatus['2xx']).toBe(2);
    expect(byStatus['5xx']).toBe(1);
    expect(byStatus['4xx']).toBe(1);
  });

  it('groups counts by route name', () => {
    recordRequest('orders', 200, 10);
    recordRequest('orders', 200, 20);
    recordRequest('users', 200, 5);

    const m = getMetrics();
    const byRoute = (m['requests'] as { byRoute: Record<string, number> }).byRoute;
    expect(byRoute['orders']).toBe(2);
    expect(byRoute['users']).toBe(1);
  });

  it('records latency average', () => {
    recordRequest('orders', 200, 10);
    recordRequest('orders', 200, 20);

    const m = getMetrics();
    const latency = m['upstream_latency_ms'] as { avg: number };
    expect(latency.avg).toBe(15);
  });

  it('tracks circuit breaker state', () => {
    setCircuitBreakerState('orders-svc:8080', true);

    const m = getMetrics();
    const cb = m['circuit_breakers'] as Record<string, boolean>;
    expect(cb['orders-svc:8080']).toBe(true);
  });

  it('resets all metrics on resetMetrics()', () => {
    recordRequest('orders', 200, 10);
    setCircuitBreakerState('orders-svc:8080', true);
    resetMetrics();

    const m = getMetrics();
    expect((m['requests'] as { total: number }).total).toBe(0);
  });

  it('reports uptime_seconds as a non-negative number', () => {
    const m = getMetrics();
    expect(typeof m['uptime_seconds']).toBe('number');
    expect(m['uptime_seconds'] as number).toBeGreaterThanOrEqual(0);
  });
});
