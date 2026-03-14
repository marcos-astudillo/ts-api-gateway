/**
 * In-process metrics service.
 *
 * Tracks:
 *  - Total request counts (by route, by HTTP status class)
 *  - Upstream latency histogram (configurable buckets)
 *  - Circuit breaker open/closed state per upstream
 *
 * Exposed at GET /metrics as JSON.
 * For production-grade Prometheus scraping, swap this for `prom-client`.
 */

// ─── Types ────────────────────────────────────────────────────

interface RequestCounters {
  total: number;
  byStatusClass: Record<string, number>;  // "2xx", "4xx", "5xx"
  byRoute: Record<string, number>;
}

interface LatencyHistogram {
  count: number;
  sum: number;
  p50?: number;
  p95?: number;
  p99?: number;
  buckets: Record<string, number>;         // "le_10ms", "le_50ms", etc.
}

// ─── Bucket definitions ───────────────────────────────────────
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// ─── State ────────────────────────────────────────────────────
const state = {
  startedAt: new Date(),
  requests: { total: 0, byStatusClass: {}, byRoute: {} } as RequestCounters,
  latency: buildEmptyHistogram(),
  circuitBreakers: {} as Record<string, boolean>,
  // Rolling window for approximate percentile calculation (last 1000 samples)
  latencySamples: [] as number[],
};

function buildEmptyHistogram(): LatencyHistogram {
  const buckets: Record<string, number> = {};
  for (const b of LATENCY_BUCKETS_MS) {
    buckets[`le_${b}ms`] = 0;
  }
  return { count: 0, sum: 0, buckets };
}

// ─── Public API ───────────────────────────────────────────────

export function recordRequest(
  route: string,
  statusCode: number,
  latencyMs: number,
): void {
  state.requests.total++;

  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  state.requests.byStatusClass[statusClass] =
    (state.requests.byStatusClass[statusClass] ?? 0) + 1;

  state.requests.byRoute[route] = (state.requests.byRoute[route] ?? 0) + 1;

  // Histogram
  state.latency.count++;
  state.latency.sum += latencyMs;
  for (const b of LATENCY_BUCKETS_MS) {
    if (latencyMs <= b) {
      state.latency.buckets[`le_${b}ms`]++;
    }
  }

  // Rolling sample for percentiles
  state.latencySamples.push(latencyMs);
  if (state.latencySamples.length > 1000) {
    state.latencySamples.shift();
  }
}

export function setCircuitBreakerState(upstream: string, isOpen: boolean): void {
  state.circuitBreakers[upstream] = isOpen;
}

export function getMetrics(): Record<string, unknown> {
  const sorted = [...state.latencySamples].sort((a, b) => a - b);
  const percentile = (p: number): number | undefined => {
    if (sorted.length === 0) return undefined;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const avgLatency =
    state.latency.count > 0
      ? Math.round((state.latency.sum / state.latency.count) * 100) / 100
      : 0;

  return {
    uptime_seconds: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
    requests: state.requests,
    upstream_latency_ms: {
      avg: avgLatency,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
      count: state.latency.count,
      histogram: state.latency.buckets,
    },
    circuit_breakers: state.circuitBreakers,
  };
}

/** Resets all counters — useful in tests. */
export function resetMetrics(): void {
  state.requests = { total: 0, byStatusClass: {}, byRoute: {} };
  state.latency = buildEmptyHistogram();
  state.latencySamples = [];
}
