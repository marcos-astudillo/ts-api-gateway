/**
 * k6 Stress Test
 *
 * Purpose : Push the gateway well beyond its expected capacity to find the
 *           breaking point and verify it degrades gracefully (circuit breaker
 *           opens, rate limiter kicks in, no panics / OOM).
 *
 * Stages:
 *   0 →  50 VUs in 2 min  (warm up)
 *   50 → 100 VUs in 2 min (load increase)
 *  100 → 200 VUs in 2 min (high stress)
 *  200 → 300 VUs in 2 min (breaking point)
 *  300 →   0 VUs in 2 min (recovery)
 *
 * Thresholds are intentionally lenient — the goal is observability, not pass/fail:
 *   p(95) < 2 000 ms   (under stress latency will rise)
 *   error rate < 20 %  (some 429 / 503 are expected and correct)
 *
 * Run:
 *   k6 run tests/load/stress.js
 *   k6 run --env BASE_URL=http://staging.example.com tests/load/stress.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = __ENV.ADMIN_API_KEY || 'dev-admin-key-123456';

export const errorRate        = new Rate('errors');
export const rateLimited      = new Counter('rate_limited_429');
export const circuitOpen      = new Counter('circuit_open_503');
export const gatewayTimeout   = new Counter('gateway_timeout_504');
export const proxyLatency     = new Trend('proxy_latency_ms', true);

export const options = {
  stages: [
    { duration: '2m', target: 50  },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '2m', target: 0   },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    errors:            ['rate<0.20'],
  },
};

// ─── Setup ────────────────────────────────────────────────────────────────────
export function setup() {
  const res = http.post(
    `${BASE_URL}/admin/routes`,
    JSON.stringify({
      name: 'stress-test-route',
      match: { path_prefix: '/stress' },
      upstream: { host: 'httpbin.org', port: 80 },
      timeouts_ms: { connect: 2000, request: 10000 },
      retries: 0,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ADMIN_KEY,
      },
    },
  );
  if (res.status !== 201 && res.status !== 409) {
    console.warn(`Setup: unexpected status ${res.status}`);
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
export function teardown() {
  const list = http.get(`${BASE_URL}/admin/routes`, {
    headers: { 'x-api-key': ADMIN_KEY },
  });
  if (list.status === 200) {
    const routes = JSON.parse(list.body);
    const target = routes.find((r) => r.name === 'stress-test-route');
    if (target) {
      http.del(`${BASE_URL}/admin/routes/${target.id}`, null, {
        headers: { 'x-api-key': ADMIN_KEY },
      });
    }
  }
}

// ─── Default scenario ─────────────────────────────────────────────────────────
export default function () {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/stress/status/200`);
  proxyLatency.add(Date.now() - start);

  // Track interesting status codes without failing the test
  if (res.status === 429) rateLimited.add(1);
  if (res.status === 503) circuitOpen.add(1);
  if (res.status === 504) gatewayTimeout.add(1);

  const ok = check(res, {
    'not 5xx server error': (r) =>
      // 200 (ok), 429 (rate-limited — expected), 503 (circuit open — expected), 504 (timeout) are all "handled"
      r.status !== 500 && r.status !== 502,
  });
  errorRate.add(!ok);

  // No sleep — maximise throughput to stress the gateway
}
