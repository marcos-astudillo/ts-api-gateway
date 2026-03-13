# Request Flow Diagrams

## Middleware Pipeline

Every request through the gateway traverses this pipeline in order:

```mermaid
flowchart TD
    A([Incoming Request]) --> B[traceIdMiddleware\nInject/Propagate X-Request-ID]
    B --> C{Is path\n/admin/*?}
    C -- yes --> D[adminAuthMiddleware\nValidate x-api-key]
    D --> E[Admin Handler\nCRUD routes/policies]
    C -- no --> F[authMiddleware\nCheck route policy]
    F --> G{auth_required?}
    G -- no --> H[rateLimitMiddleware\nRedis sliding window]
    G -- yes --> I{Valid JWT?}
    I -- yes --> H
    I -- no --> J([401 Unauthorized])
    H --> K{Within limit?}
    K -- no --> L([429 Too Many Requests])
    K -- yes --> M[Route Matcher\nLongest prefix wins]
    M --> N{Route found?}
    N -- no --> O([404 No matching route])
    N -- yes --> P[Circuit Breaker\nPer-upstream opossum]
    P --> Q{Breaker open?}
    Q -- yes --> R([503 Service Unavailable])
    Q -- no --> S[undici Proxy\nForward to upstream]
    S --> T{Upstream OK?}
    T -- no --> U{Timeout?}
    U -- yes --> V([504 Gateway Timeout])
    U -- no --> W([502 Bad Gateway])
    T -- yes --> X[Record Metrics\nlatency, status, route]
    X --> Y([Upstream Response\n+ X-Request-ID header])
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

## Canary / Traffic Splitting (Future)

> Currently behind `FEATURE_CANARY_RELEASES=false` flag.

```mermaid
flowchart LR
    R([Request]) --> GW[Gateway]
    GW -->|90%| STABLE[Stable v1.2\norders.svc]
    GW -->|10%| CANARY[Canary v1.3\norders-canary.svc]
```

When enabled, the gateway uses a weighted random selection between upstreams
defined in the route configuration.
