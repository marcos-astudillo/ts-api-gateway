# Example Services

Two minimal Node.js HTTP services used to demonstrate the API Gateway's
routing, canary traffic splitting, response caching, and upstream health
monitoring features end-to-end.

| Service | Default port | Routes |
|---------|-------------|--------|
| **users** | `8081` | `GET/POST /users`, `GET /users/:id` |
| **orders** (stable) | `8082` | `GET/POST /orders`, `GET /orders/:id` |
| **orders-canary** | `8083` | Same as stable — simulates a v2 release |

Both services respond with an `x-service-version` header so you can verify
which variant received each request during canary testing.

## Quick Start with Docker Compose

```bash
# Start everything (gateway + postgres + redis + example services)
docker compose up --build

# In a separate terminal — register routes and policies
./example-services/setup.sh
```

## Quick Start without Docker

```bash
# Terminal 1 — Users service
node example-services/users/server.js

# Terminal 2 — Orders stable
node example-services/orders/server.js

# Terminal 3 — Orders canary
PORT=8083 VERSION=v2-canary LATENCY_MS=50 node example-services/orders/server.js

# Terminal 4 — Gateway (see project root README for full setup)
npm run dev

# Register routes
./example-services/setup.sh
```

## Testing canary traffic splitting

1. Register the canary route (done by `setup.sh`).
2. Set `FEATURE_CANARY_RELEASES=true` in your `.env`.
3. Restart the gateway.
4. Make repeated requests to `/orders-canary` and watch the `x-service-version` header:

```bash
for i in $(seq 1 20); do
  curl -s http://localhost:3000/orders-canary/orders \
    | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['version'])"
done
```

You should see `v1` approximately 90 % of the time and `v2-canary` ~10 % of the time.

## Testing response caching

```bash
# First request — cache MISS
curl -v http://localhost:3000/users 2>&1 | grep -i "x-cache"
# → x-cache: MISS

# Second request — cache HIT (TTL 60 s set by setup.sh)
curl -v http://localhost:3000/users 2>&1 | grep -i "x-cache"
# → x-cache: HIT
# → x-cache-age: 2
```

## Testing upstream health

```bash
# Check health of all registered upstreams
curl http://localhost:3000/admin/upstreams \
  -H "x-api-key: dev-admin-key-123456" | python3 -m json.tool
```

Set `UPSTREAM_HEALTH_ENABLED=true` in `.env` to enable background probing.
