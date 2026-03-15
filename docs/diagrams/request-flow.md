# Request Flow Diagrams

## Middleware Pipeline

Every request through the gateway traverses this pipeline in order:

```mermaid
flowchart TD
    A([Incoming Request]) --> B[traceIdMiddleware\nParse traceparent / generate\nSet B3 + x-request-id]
    B --> C{Is path\n/admin/*?}
    C -- yes --> D[adminAuthMiddleware\nValidate x-api-key]
    D --> E[Admin Handler\nCRUD routes/policies\nGET /admin/upstreams]
    C -- no --> F[authMiddleware\nCheck route policy]
    F --> G{auth_required?}
    G -- no --> H[rateLimitMiddleware\nRedis sliding window]
    G -- yes --> I{Valid JWT?}
    I -- yes --> H
    I -- no --> J([401 Unauthorized])
    H --> K{Within limit?}
    K -- no --> L([429 Too Many Requests])
    K -- yes --> CACHE[cacheMiddleware\nCheck Redis cache\nGET+HEAD only]
    CACHE --> CM{Cache HIT?}
    CM -- yes --> CACHERESP([Cached Response\nX-Cache: HIT])
    CM -- no --> M[Route Matcher\nLongest prefix wins]
    M --> N{Route found?}
    N -- no --> O([404 No matching route])
    N -- yes --> SPLIT{FEATURE_CANARY_RELEASES?}
    SPLIT -- yes --> CS[Traffic Splitter\nWeighted coin flip]
    SPLIT -- no --> P
    CS --> P[Circuit Breaker\nPer-upstream opossum]
    P --> Q{Breaker open?}
    Q -- yes --> R([503 Service Unavailable])
    Q -- no --> S[upstream-client\nRetry + AbortSignal.timeout]
    S --> T{Upstream OK?}
    T -- no --> U{Timeout?}
    U -- yes --> V([504 Gateway Timeout])
    U -- no --> W([502 Bad Gateway])
    T -- yes --> X[cacheOnSend hook\nStore 2xx in Redis]
    X --> Y[Record Metrics\nlatency, status, route]
    Y --> Z([Upstream Response\n+ traceparent + X-Cache: MISS])
```

## Rate Limiting: Sliding Window Algorithm

```mermaid
flowchart LR
    subgraph Redis Key: rl:orders:user-123
        direction LR
        T1[t=1000ms] --> T2[t=1200ms] --> T3[t=1500ms] --> T4[t=1900ms]
    end

    REQ([New Request t=2100ms]) --> CLEAN[ZREMRANGEBYSCORE\nRemove entries before\nt=2100-1000=1100ms]
    CLEAN --> COUNT[ZCARD = 3\nentries remain]
    COUNT --> CHECK{count < burst?}
    CHECK -- yes --> ADD[ZADD t=2100ms\nAllow ✓]
    CHECK -- no --> REJECT[Reject 429]
```

## Canary Traffic Splitting

Controlled by the `FEATURE_CANARY_RELEASES=true` flag. Per-route canary
configuration is stored in the `routes` table (`canary_upstream_host`,
`canary_upstream_port`, `canary_weight`).

```mermaid
flowchart LR
    R([Request]) --> GW[Gateway\nselectUpstream]
    GW -->|100 - weight %| STABLE[Stable upstream\ne.g. orders:8080]
    GW -->|weight %| CANARY[Canary upstream\ne.g. orders-canary:8090]
    STABLE & CANARY --> CB[Per-upstream\nCircuit Breaker]
```

The selection is a stateless weighted coin flip (`Math.random() * 100 < canaryWeight`).
Each upstream has its own independent circuit breaker.

## Upstream Health Monitoring

Background loop runs every `UPSTREAM_HEALTH_CHECK_INTERVAL_MS` ms
(requires `UPSTREAM_HEALTH_ENABLED=true`).

```mermaid
sequenceDiagram
    participant LOOP as Health Loop (background)
    participant UP as Upstream (HEAD /)
    participant MAP as In-Memory healthMap
    participant CB as Circuit Breaker Registry
    participant API as GET /admin/upstreams

    loop every UPSTREAM_HEALTH_CHECK_INTERVAL_MS
        LOOP->>UP: HEAD / (timeout: UPSTREAM_HEALTH_TIMEOUT_MS)
        UP-->>LOOP: latencyMs, ok
        LOOP->>CB: getAllBreakers() → state
        LOOP->>MAP: upsert { status, latencyMs, consecutiveFailures, circuitBreaker }
    end

    API->>MAP: getAllUpstreamHealth()
    MAP-->>API: UpstreamHealth[]
```

## Response Cache

Redis-backed GET/HEAD response caching with per-route TTL.

```mermaid
sequenceDiagram
    participant C as Client
    participant MW as cacheMiddleware (preHandler)
    participant REDIS as Redis
    participant PROXY as Proxy Handler
    participant SEND as cacheOnSend (onSend)

    C->>MW: GET /api/products
    MW->>REDIS: GET gw:cache:products:GET:/api/products
    alt HIT
        REDIS-->>MW: { statusCode, headers, body (base64) }
        MW-->>C: 200 + X-Cache: HIT + X-Cache-Age: Ns
    else MISS
        MW-->>PROXY: continue (sets cacheKey + cacheTtl in context)
        PROXY-->>SEND: upstream 200 response
        SEND->>REDIS: SETEX gw:cache:... ttl base64body
        SEND-->>C: 200 + X-Cache: MISS
    end
```
