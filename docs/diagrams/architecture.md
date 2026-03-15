# Architecture Diagram

## High-Level System Architecture

```mermaid
flowchart LR
    C([Client]) -->|HTTPS| EDGE[TLS Termination\nL4 Load Balancer]
    EDGE -->|HTTP| GW1[Gateway Instance 1]
    EDGE -->|HTTP| GW2[Gateway Instance 2]
    EDGE -->|HTTP| GWN[Gateway Instance N]

    subgraph Gateway Cluster [Stateless Gateway Cluster]
        direction TB
        GW1 & GW2 & GWN
    end

    Gateway Cluster --> TRACE[Trace Middleware\nW3C traceparent + B3]
    Gateway Cluster --> AUTH[Auth Middleware\nJWT + JWKS Cache]
    Gateway Cluster --> RL[Rate Limiter\nRedis Sliding Window]
    Gateway Cluster --> CACHE[Response Cache\nRedis TTL per-route]
    Gateway Cluster --> ROUTER[Route Matcher\nPath-Prefix Tree]

    ROUTER --> CS[Traffic Splitter\nWeighted canary selection]
    CS -->|stable %| S1[Service A - stable\ne.g. Orders :8080]
    CS -->|canary %| S1C[Service A - canary\ne.g. Orders :8090]
    ROUTER --> S2[Service B\ne.g. Users :8081]
    ROUTER --> S3[Service C\ne.g. Payments :8082]

    Gateway Cluster <-->|Config poll every 5s| DB[(PostgreSQL\nConfig Store)]
    Gateway Cluster <-->|Rate limit counters\nResponse cache| REDIS[(Redis)]
    Gateway Cluster --> OBS[Observability\n/metrics /healthz /readyz\n/admin/upstreams]
    Gateway Cluster -->|Health probes every 30s| S1 & S2 & S3

    style Gateway Cluster fill:#f0f4ff,stroke:#4f6ef7
    style DB fill:#e8f5e9,stroke:#43a047
    style REDIS fill:#fff3e0,stroke:#fb8c00
    style CS fill:#fce4ec,stroke:#e91e63
    style TRACE fill:#e3f2fd,stroke:#1976d2
    style CACHE fill:#fff9c4,stroke:#f9a825
```

## Request Flow Through One Gateway Instance

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as API Gateway
    participant TRACE as Trace Middleware
    participant CACHE as Cache Middleware
    participant AUTH as Auth Middleware
    participant RL as Rate Limiter
    participant CS as Traffic Splitter
    participant CB as Circuit Breaker
    participant UP as Upstream Service
    participant REDIS as Redis

    C->>GW: HTTP Request + Bearer Token
    GW->>TRACE: Parse/generate traceparent + B3 headers
    TRACE-->>GW: traceId, spanId set in context
    GW->>AUTH: Is auth_required for this route?
    AUTH->>AUTH: Verify JWT via JWKS (cached)
    AUTH-->>GW: userId = sub claim
    GW->>RL: Check Redis sliding window
    RL-->>GW: allowed=true, remaining=49
    GW->>CACHE: Lookup cache key (GET/HEAD only)
    alt Cache HIT
        CACHE->>REDIS: GET gw:cache:{key}
        REDIS-->>CACHE: cached response
        CACHE-->>C: 200 OK (X-Cache: HIT)
    else Cache MISS
        CACHE-->>GW: continue
        GW->>GW: Match route by path prefix
        GW->>CS: selectUpstream(route)
        CS-->>GW: { host, port, variant: stable|canary }
        GW->>CB: fire(proxyOptions)
        CB->>UP: Forward request via undici
        UP-->>CB: 200 OK + body
        CB-->>GW: ProxyResult
        GW->>REDIS: SETEX gw:cache:{key} {ttl} (if cacheable)
        GW->>GW: Record metrics (latency, status)
        GW-->>C: 200 OK + traceparent + X-Cache: MISS
    end
```

## Circuit Breaker State Machine

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> OPEN: error rate ≥ threshold\n(within volumeThreshold)
    OPEN --> HALF_OPEN: after resetTimeout ms
    HALF_OPEN --> CLOSED: probe request succeeds
    HALF_OPEN --> OPEN: probe request fails

    state CLOSED {
        [*] --> passing
        passing: Requests pass through normally
    }
    state OPEN {
        [*] --> rejecting
        rejecting: Fail-fast with 503
    }
    state HALF_OPEN {
        [*] --> probing
        probing: One probe request sent
    }
```
