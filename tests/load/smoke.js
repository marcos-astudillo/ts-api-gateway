/**
 * k6 Smoke Test
 *
 * Purpose : Verify the gateway is reachable and returns correct responses
 *           with minimal traffic (1 VU, 30 s).
 *
 * Run:
 *   k6 run tests/load/smoke.js
 *   k6 run --env BASE_URL=http://staging.example.com tests/load/smoke.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = __ENV.ADMIN_API_KEY || 'dev-admin-key-123456';

export const errorRate = new Rate('errors');

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

// ─── Setup: create a smoke-test route via Admin API ───────────────────────────
export function setup() {
  const res = http.post(
    `${BASE_URL}/admin/routes`,
    JSON.stringify({
      name: 'smoke-test-route',
      match: { path_prefix: '/smoke' },
      upstream: { host: 'httpbin.org', port: 80 },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ADMIN_KEY,
      },
    },
  );

  if (res.status !== 201 && res.status !== 409) {
    console.warn(`Setup: unexpected status ${res.status} creating smoke route`);
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
export function teardown() {
  // List routes and delete the smoke route if it exists
  const list = http.get(`${BASE_URL}/admin/routes`, {
    headers: { 'x-api-key': ADMIN_KEY },
  });
  if (list.status === 200) {
    const routes = JSON.parse(list.body);
    const target = routes.find((r) => r.name === 'smoke-test-route');
    if (target) {
      http.del(`${BASE_URL}/admin/routes/${target.id}`, null, {
        headers: { 'x-api-key': ADMIN_KEY },
      });
    }
  }
}

// ─── Default scenario ─────────────────────────────────────────────────────────
export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/healthz`);
  const healthOk = check(health, {
    'healthz: status 200': (r) => r.status === 200,
  });
  errorRate.add(!healthOk);

  // Readiness check
  const ready = http.get(`${BASE_URL}/readyz`);
  check(ready, {
    'readyz: status 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  // Admin: list routes (authenticated)
  const routes = http.get(`${BASE_URL}/admin/routes`, {
    headers: { 'x-api-key': ADMIN_KEY },
  });
  const routesOk = check(routes, {
    'GET /admin/routes: status 200': (r) => r.status === 200,
    'GET /admin/routes: returns array': (r) => Array.isArray(JSON.parse(r.body)),
  });
  errorRate.add(!routesOk);

  // Admin: unauthorized request returns 401
  const unauth = http.get(`${BASE_URL}/admin/routes`);
  check(unauth, {
    'GET /admin/routes without key: 401': (r) => r.status === 401,
  });

  sleep(1);
}
