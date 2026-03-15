# Load Tests

Performance and resilience tests for the API Gateway using [k6](https://k6.io).

## Prerequisites

```bash
# macOS
brew install k6

# Windows (Chocolatey)
choco install k6

# Docker
docker pull grafana/k6
```

## Test Suites

| Script | VUs | Duration | Purpose |
|--------|-----|----------|---------|
| `smoke.js` | 1 | 30 s | Sanity check — is the gateway reachable? |
| `load.js` | 0 → 20 → 0 | 5 min | Steady-state SLO validation |
| `stress.js` | 0 → 300 → 0 | 10 min | Find the breaking point; verify graceful degradation |

## Running Tests

### Against local dev

```bash
# Start the gateway first
npm run dev

# Smoke test (quick sanity check)
k6 run tests/load/smoke.js

# Load test
k6 run tests/load/load.js

# Stress test
k6 run tests/load/stress.js
```

### Against a remote environment

```bash
k6 run \
  --env BASE_URL=https://gateway.staging.example.com \
  --env ADMIN_API_KEY=your-key \
  tests/load/load.js
```

### With Docker

```bash
docker run --rm -i \
  -e BASE_URL=http://host.docker.internal:3000 \
  -e ADMIN_API_KEY=dev-admin-key-123456 \
  -v "$(pwd)/tests/load:/scripts" \
  grafana/k6 run /scripts/load.js
```

## SLO Thresholds

| Test | Metric | Threshold |
|------|--------|-----------|
| smoke / load | `p(95) http_req_duration` | < 500 ms |
| smoke / load | `p(99) http_req_duration` | < 1 000 ms |
| smoke / load | error rate | < 1 % |
| stress | `p(95) http_req_duration` | < 2 000 ms |
| stress | error rate | < 20 % (429 + 503 expected) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Gateway base URL |
| `ADMIN_API_KEY` | `dev-admin-key-123456` | Admin API key |

## Metrics Tracked

- `errors` — failed request rate
- `proxy_latency_ms` — end-to-end proxy latency trend
- `cache_hits` / `cache_misses` — Redis cache effectiveness
- `rate_limited_429` — requests throttled by the rate limiter
- `circuit_open_503` — requests short-circuited by opossum
- `gateway_timeout_504` — upstream timeout responses
