/**
 * k6 Load Test
 *
 * Purpose : Simulate realistic sustained traffic and verify the gateway
 *           meets its SLOs under normal operating load.
 *
 * Stages:
 *   0 → 20 VUs in 1 min  (ramp-up)
 *   20 VUs for 3 min      (steady state)
 *   20 → 0 VUs in 1 min  (ramp-down)
 *
 * SLO thresholds (adjust to match your SLA):
 *   p(95) latency < 500 ms
 *   p(99) latency < 1 000 ms
 *   error rate    < 1 %
 *
 * Run:
 *   k6 run tests/load/load.js
 *   k6 run --env BASE_URL=http://staging.example.com tests/load/load.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = __ENV.ADMIN_API_KEY || 'dev-admin-key-123456';

export const errorRate    = new Rate('errors');
export const cacheHits    = new Counter('cache_hits');
export const cacheMisses  = new Counter('cache_misses');
export const proxyLatency = new Trend('proxy_latency_ms', true);

export const options = {
  stages: [
    { duration: '1m',  target: 20 },
    { duration: '3m',  target: 20 },
    { duration: '1m',  target: 0  },
  ],
  thresholds: {
    http_req_duration:  ['p(95)<500', 'p(99)<1000'],
    errors:             ['rate<0.01'],
    proxy_latency_ms:   ['p(95)<500'],
  },
};

// ─── Setup ────────────────────────────────────────────────────────────────────
export function setup() {
  const res = http.post(
    `${BASE_URL}/admin/routes`,
    JSON.stringify({
      name: 'load-test-route',
      match: { path_prefix: '/load' },
      upstream: { host: 'httpbin.org', port: 80 },
      timeouts_ms: { connect: 500, request: 5000 },
      retries: 1,
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
    const target = routes.find((r) => r.name === 'load-test-route');
    if (target) {
      http.del(`${BASE_URL}/admin/routes/${target.id}`, null, {
        headers: { 'x-api-key': ADMIN_KEY },
      });
    }
  }
}

// ─── Default scenario ─────────────────────────────────────────────────────────
export default function () {
  group('health probes', () => {
    const h = http.get(`${BASE_URL}/healthz`);
    check(h, { 'healthz 200': (r) => r.status === 200 });
    errorRate.add(h.status !== 200);
  });

  group('admin api', () => {
    const r = http.get(`${BASE_URL}/admin/routes`, {
      headers: { 'x-api-key': ADMIN_KEY },
    });
    const ok = check(r, {
      'list routes 200': (res) => res.status === 200,
    });
    errorRate.add(!ok);

    // Upstream health (no-op data when UPSTREAM_HEALTH_ENABLED=false)
    const u = http.get(`${BASE_URL}/admin/upstreams`, {
      headers: { 'x-api-key': ADMIN_KEY },
    });
    check(u, { 'upstreams 200': (res) => res.status === 200 });
  });

  group('proxy passthrough', () => {
    const start = Date.now();
    // httpbin.org/status/200 — lightweight endpoint
    const p = http.get(`${BASE_URL}/load/status/200`);
    proxyLatency.add(Date.now() - start);

    const ok = check(p, {
      'proxy 200': (r) => r.status === 200,
      'has x-request-id': (r) => r.headers['x-request-id'] !== undefined,
    });
    errorRate.add(!ok);

    // Track cache header
    const xCache = p.headers['x-cache'];
    if (xCache === 'HIT')       cacheHits.add(1);
    else if (xCache === 'MISS') cacheMisses.add(1);
  });

  sleep(0.5);
}
