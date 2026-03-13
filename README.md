# ts-api-gateway

> A production-ready **API Gateway** built with Node.js, TypeScript, and Fastify.
> Implements routing, authentication (JWT/JWKS), Redis rate limiting, circuit breakers, config hot reload, and full observability.

[![CI](https://github.com/YOUR_USERNAME/ts-api-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/ts-api-gateway/actions)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Docker](#docker)
- [Testing](#testing)
- [Deployment (Railway)](#deployment-railway)
- [Scaling Considerations](#scaling-considerations)
- [System Design Reference](#system-design-reference)

---

## Features

| Feature | Description |
|---|---|
| **Dynamic Routing** | Path-prefix matching with longest-match wins, loaded from PostgreSQL |
| **Auth (JWT/JWKS)** | Per-route JWT validation with cached JWKS key fetching |
| **Rate Limiting** | Redis sliding-window per route + per client (IP or user ID) |
| **Circuit Breaker** | Per-upstream opossum breaker — prevents cascading failures |
| **Config Hot Reload** | Routes and policies reload without restart via DB version polling |
| **Observability** | Structured JSON logs (pino), `/metrics`, `/healthz`, `/readyz` |
| **Admin API** | REST API to manage routes and policies at runtime |
| **Tracing** | X-Request-ID propagated end-to-end through all services |

**Feature flags** (set in `.env`):

| Flag | Default | Description |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | Toggle rate limiting on/off |
| `FEATURE_CANARY_RELEASES` | `false` | Enable weighted traffic splitting (future) |
| `FEATURE_ANALYTICS` | `false` | Enable analytics event emission (future) |

---

## Architecture

```
Client → TLS Termination / L4 LB → Gateway Instances (stateless) → Upstream Services
                                            ↕                ↕
                                       PostgreSQL          Redis
                                      (config store)   (rate limits)
```

See full diagrams in [`docs/diagrams/`](./docs/diagrams/):
- [Architecture diagram](./docs/diagrams/architecture.md)
- [Data model](./docs/diagrams/data-model.md)
- [Request flow](./docs/diagrams/request-flow.md)

**Request middleware pipeline** (in order):
```
→ traceId injection
→ auth (JWT validation if route policy requires it)
→ rate limit (Redis sliding window)
→ route matching (longest prefix)
→ circuit breaker (per upstream)
→ undici HTTP proxy
→ metrics recording
→ response
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript 5 |
| HTTP Framework | Fastify 4 |
| Database | PostgreSQL 16 |
| Cache / Rate limiting | Redis 7 |
| HTTP Proxy | undici (Node.js built-in) |
| Circuit Breaker | opossum |
| Auth | jsonwebtoken + jwks-rsa |
| Validation | Zod |
| Logging | pino |
| Testing | Vitest |
| Container | Docker (multi-stage) |
| CI/CD | GitHub Actions |
| Hosting | Railway |

---

## Project Structure

```
ts-api-gateway/
├── src/
│   ├── config/           # env validation, DB pool, Redis client
│   ├── controllers/      # Admin API request handlers
│   ├── middlewares/       # trace-id, auth, rate-limit, admin-auth, error handler
│   ├── models/           # TypeScript interfaces (Route, Policy, ConfigVersion)
│   ├── repositories/     # Typed PostgreSQL access layer
│   ├── routes/           # Fastify route registrations
│   │   ├── admin.routes.ts
│   │   ├── health.routes.ts
│   │   └── proxy.routes.ts   ← catch-all proxy
│   ├── services/
│   │   ├── auth/         # JWT verification + JWKS caching
│   │   ├── metrics/      # In-process request/latency metrics
│   │   ├── proxy/        # undici proxy + circuit breaker
│   │   ├── ratelimit/    # Redis sliding window
│   │   └── router/       # Route matcher + in-memory config cache
│   ├── types/            # Module augmentations
│   ├── app.ts            # Fastify app factory (testable without port binding)
│   ├── logger.ts         # pino structured logger
│   └── server.ts         # Entry point — binds port, graceful shutdown
├── tests/
│   ├── helpers/          # DB setup/teardown for integration tests
│   ├── unit/             # Route matcher, rate limiter, metrics
│   └── integration/      # Admin API, proxy routing
├── docs/diagrams/        # Architecture, data model, request flow (Mermaid)
├── scripts/
│   └── migrate.ts        # Database migration runner
├── docker/
│   └── Dockerfile        # Multi-stage build
├── .github/workflows/
│   └── ci.yml            # Typecheck → lint → test → build → deploy
├── docker-compose.yml    # Full local stack: gateway + postgres + redis
├── railway.toml          # Railway deployment config
└── .env.example          # All environment variables documented
```

---

## API Reference

### Admin API

All admin endpoints require the `x-api-key` header.

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/routes` | List all routes |
| `POST` | `/admin/routes` | Create a route |
| `GET` | `/admin/routes/:id` | Get route by ID |
| `PUT` | `/admin/routes/:id` | Update a route |
| `DELETE` | `/admin/routes/:id` | Delete a route |

**Create route — `POST /admin/routes`**
```json
{
  "name": "orders",
  "match": { "path_prefix": "/v1/orders" },
  "upstream": { "host": "orders.svc", "port": 8080 },
  "strip_path": false,
  "timeouts_ms": { "connect": 200, "request": 2000 },
  "retries": 2
}
```

#### Policies

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/policies` | List all policies |
| `POST` | `/admin/policies` | Create or update a policy |
| `DELETE` | `/admin/policies/:id` | Delete a policy |

**Create policy — `POST /admin/policies`**
```json
{
  "route": "orders",
  "auth_required": true,
  "rate_limit": { "rps": 50, "burst": 100 }
}
```

### Observability

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness probe — always 200 |
| `GET` | `/readyz` | Readiness probe — checks DB + Redis |
| `GET` | `/metrics` | Request counts, latency histogram, circuit breaker state |

### Proxy

All other paths are matched against registered routes and proxied to the configured upstream.

```
GET /v1/orders/123
→ matched by route with path_prefix: /v1/orders
→ forwarded to http://orders.svc:8080/v1/orders/123
```

**Response headers always include:**
- `X-Request-ID` — trace ID for end-to-end correlation
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | ✅ | — | Redis connection string |
| `ADMIN_API_KEY` | ✅ | — | Secret for `/admin/*` endpoints (min 16 chars) |
| `PORT` | | `3000` | Server port |
| `LOG_LEVEL` | | `info` | `trace\|debug\|info\|warn\|error` |
| `JWKS_URI` | | — | JWKS endpoint for JWT validation |
| `JWT_AUDIENCE` | | `api-gateway` | Expected JWT audience claim |
| `JWT_ISSUER` | | — | Expected JWT issuer claim |
| `JWKS_CACHE_TTL_SECONDS` | | `600` | How long to cache JWKS public keys |
| `RATE_LIMIT_ENABLED` | | `true` | Toggle rate limiting |
| `RATE_LIMIT_DEFAULT_RPS` | | `100` | Default RPS when route has no policy |
| `RATE_LIMIT_DEFAULT_BURST` | | `200` | Default burst when route has no policy |
| `CONFIG_RELOAD_INTERVAL_MS` | | `5000` | How often to poll for config changes |
| `CIRCUIT_BREAKER_TIMEOUT_MS` | | `3000` | Per-request timeout inside breaker |
| `CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT` | | `50` | Error % to open the breaker |
| `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` | | `10000` | Wait before probing after open |
| `FEATURE_CANARY_RELEASES` | | `false` | Enable traffic splitting (WIP) |
| `FEATURE_ANALYTICS` | | `false` | Enable analytics (WIP) |

---

## Running Locally

**Prerequisites:** Node.js 20+, Docker (for PostgreSQL + Redis)

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/ts-api-gateway
cd ts-api-gateway
npm install

# 2. Start infrastructure
docker compose up postgres redis -d

# 3. Configure environment
cp .env.example .env
# Set ADMIN_API_KEY=my-dev-secret-key-12345

# 4. Run migrations
npm run db:migrate

# 5. Start the dev server (hot-reload)
npm run dev
```

The gateway is now listening at `http://localhost:3000`.

**Quick smoke test:**
```bash
# Health check
curl http://localhost:3000/healthz

# Create a route (requires running upstream)
curl -X POST http://localhost:3000/admin/routes \
  -H "x-api-key: my-dev-secret-key-12345" \
  -H "content-type: application/json" \
  -d '{"name":"httpbin","match":{"path_prefix":"/test"},"upstream":{"host":"httpbin.org","port":80}}'

# Proxy a request
curl http://localhost:3000/test/get
```

---

## Docker

**Build and run everything with Docker Compose:**

```bash
# Build and start all services
docker compose up --build

# Run only infrastructure (develop gateway locally)
docker compose up postgres redis -d

# Stop everything
docker compose down -v
```

**Build production image only:**
```bash
docker build -f docker/Dockerfile -t ts-api-gateway .
docker run -p 3000:3000 \
  -e DATABASE_URL=... \
  -e REDIS_URL=... \
  -e ADMIN_API_KEY=... \
  ts-api-gateway
```

The Dockerfile uses a **multi-stage build**:
1. `builder` — installs all deps, compiles TypeScript
2. `production` — copies only compiled JS + prod deps, runs as non-root user

---

## Testing

```bash
# Run all tests once
npm test

# Watch mode (TDD)
npm run test:watch

# With coverage report
npm run test:coverage
```

**Test categories:**

| File | Type | What it tests |
|---|---|---|
| `tests/unit/route-matcher.test.ts` | Unit | Path matching, strip_path, edge cases |
| `tests/unit/rate-limiter.test.ts` | Unit | Redis sliding window (mocked Redis) |
| `tests/unit/metrics.test.ts` | Unit | Counter/histogram recording |
| `tests/unit/app.test.ts` | Unit | App bootstrap, health endpoints |
| `tests/integration/admin.test.ts` | Integration | Admin CRUD (real PostgreSQL) |
| `tests/integration/proxy.test.ts` | Integration | Proxy routing (real upstream server) |

**Integration tests** require running PostgreSQL and Redis (started automatically in CI, use Docker locally).

---

## Deployment (Railway)

> Requires a [Railway](https://railway.app) account and the Railway CLI.

```bash
# Install CLI
npm install -g @railway/cli

# Login
railway login

# Create project (first time)
railway init

# Add PostgreSQL and Redis plugins in the Railway dashboard

# Set required secrets
railway variables set ADMIN_API_KEY=your-secret-here
railway variables set JWKS_URI=https://your-auth.provider/.well-known/jwks.json

# Deploy
railway up
```

**Automatic deploys** via GitHub Actions are configured in `.github/workflows/ci.yml`.
Set the `RAILWAY_TOKEN` secret in your GitHub repository settings.

The deployment pipeline:
```
push to main → typecheck → lint → test → build → Docker build → Railway deploy
```

---

## Scaling Considerations

Based on the [system design](https://github.com/marcos-astudillo/system-design-notes):

| Concern | Solution |
|---|---|
| **High throughput (100k+ RPS)** | Horizontal scaling — add gateway instances behind L4 LB |
| **Stateless instances** | Config in PostgreSQL, rate-limit counters in Redis |
| **p95 latency < 10ms** | Fastify + undici + in-memory route cache (no DB on hot path) |
| **Config changes** | Versioned hot reload — no restart needed |
| **Upstream failures** | Circuit breakers prevent cascading failures |
| **JWKS bottleneck** | Public keys cached for `JWKS_CACHE_TTL_SECONDS` (default 10 min) |
| **Redis rate-limit latency** | Lua script = single round-trip; fail-open if Redis unavailable |
| **Heavy config pushes** | Staggered per-instance polling avoids thundering reload |
| **Availability (99.95%+)** | Multiple instances + health checks + graceful shutdown |

---

## System Design Reference

This implementation is based on the **API Gateway** system design from:

> 📐 [system-design-notes](https://github.com/marcos-astudillo/system-design-notes/blob/main/designs/api-gateway.md)

The design covers:
- Problem statement and functional requirements
- High-level architecture with Mermaid diagrams
- Data model and config versioning
- Scaling strategy and bottlenecks
- Trade-offs and possible improvements

---

## License

MIT
