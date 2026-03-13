# Data Model

## Entity Relationship Diagram

```mermaid
erDiagram
    ROUTES {
        uuid   id                 PK
        string name               UK "e.g. orders"
        string path_prefix           "e.g. /v1/orders"
        string upstream_host         "e.g. orders.svc"
        int    upstream_port         "e.g. 8080"
        bool   strip_path            "strip prefix before forwarding"
        int    connect_timeout_ms    "default 200ms"
        int    request_timeout_ms    "default 2000ms"
        int    retries               "default 2"
        bool   enabled               "hot-disable without delete"
        ts     created_at
        ts     updated_at
    }

    POLICIES {
        uuid  id               PK
        uuid  route_id         FK
        bool  auth_required       "require Bearer JWT"
        int   rate_limit_rps      "requests per second (nullable)"
        int   rate_limit_burst    "max in window (nullable)"
        ts    created_at
        ts    updated_at
    }

    CONFIG_VERSIONS {
        serial id           PK
        int    version         "monotonically increasing"
        string checksum        "random hex — identifies the config snapshot"
        ts     published_at
    }

    SCHEMA_MIGRATIONS {
        int    version     PK
        string name
        ts     applied_at
    }

    ROUTES ||--o| POLICIES : "has one"
```

## Config Version Flow

```mermaid
sequenceDiagram
    participant ADM as Admin API
    participant DB as PostgreSQL
    participant GW1 as Gateway Instance 1
    participant GW2 as Gateway Instance 2

    ADM->>DB: INSERT route (v1)
    ADM->>DB: INSERT config_version(version=1)

    Note over GW1,GW2: Poll every CONFIG_RELOAD_INTERVAL_MS

    GW1->>DB: SELECT latest config_version
    DB-->>GW1: version=1 (new!)
    GW1->>DB: SELECT routes + policies
    GW1->>GW1: Update in-memory cache atomically

    GW2->>DB: SELECT latest config_version
    DB-->>GW2: version=1 (new!)
    GW2->>DB: SELECT routes + policies
    GW2->>GW2: Update in-memory cache atomically

    Note over GW1,GW2: No coordination needed —\neach instance reloads independently
```

## Indexes

| Table            | Index                                    | Purpose                                          |
|------------------|------------------------------------------|--------------------------------------------------|
| `routes`         | `idx_routes_path_prefix`                 | Fast prefix scan during route matching           |
| `routes`         | `idx_routes_enabled`                     | Filter only active routes during config load     |
| `policies`       | `idx_policies_route_id`                  | O(1) policy lookup by route ID                   |
| `config_versions`| `idx_config_versions_version DESC`       | O(1) latest version fetch                        |
