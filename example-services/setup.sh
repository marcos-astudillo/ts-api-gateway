#!/usr/bin/env bash
# =============================================================================
# Gateway quick-start: registers example routes so the gateway proxies to
# the users and orders example services out of the box.
#
# Usage:
#   chmod +x example-services/setup.sh
#   ./example-services/setup.sh
#
# Environment variables:
#   BASE_URL     — Gateway base URL     (default: http://localhost:3000)
#   ADMIN_API_KEY — Admin API key       (default: dev-admin-key-123456)
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_API_KEY:-dev-admin-key-123456}"
HEADERS=(-H "Content-Type: application/json" -H "x-api-key: $ADMIN_KEY")

echo "⚙️  Configuring example routes on $BASE_URL …"
echo ""

# ─── Wait for gateway to be ready ─────────────────────────────
echo "⏳  Waiting for gateway to become ready…"
for i in $(seq 1 30); do
  if curl -sf "$BASE_URL/healthz" > /dev/null 2>&1; then
    echo "✅  Gateway is up"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "❌  Gateway did not become ready in 60 s. Is it running?"
    exit 1
  fi
done
echo ""

# ─── Users route ──────────────────────────────────────────────
echo "📝  Registering /users → users-service:8081"
curl -sf -X POST "$BASE_URL/admin/routes" "${HEADERS[@]}" \
  -d '{
    "name": "users",
    "match": { "path_prefix": "/users" },
    "upstream": { "host": "users-service", "port": 8081 },
    "strip_path": false,
    "timeouts_ms": { "connect": 500, "request": 3000 },
    "retries": 2
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

# ─── Orders route (stable) ────────────────────────────────────
echo "📝  Registering /orders → orders-service:8082 (stable)"
curl -sf -X POST "$BASE_URL/admin/routes" "${HEADERS[@]}" \
  -d '{
    "name": "orders",
    "match": { "path_prefix": "/orders" },
    "upstream": { "host": "orders-service", "port": 8082 },
    "strip_path": false,
    "timeouts_ms": { "connect": 500, "request": 3000 },
    "retries": 2
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

# ─── Orders route with canary (10 % to v2) ────────────────────
echo "📝  Registering /orders-canary → orders:8082 (90%) + orders-canary:8083 (10%)"
curl -sf -X POST "$BASE_URL/admin/routes" "${HEADERS[@]}" \
  -d '{
    "name": "orders-canary",
    "match": { "path_prefix": "/orders-canary" },
    "upstream": { "host": "orders-service", "port": 8082 },
    "canary": {
      "upstream": { "host": "orders-canary", "port": 8083 },
      "weight": 10
    },
    "strip_path": false,
    "timeouts_ms": { "connect": 500, "request": 3000 },
    "retries": 2
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

# ─── Policy: cache users responses for 60 s ───────────────────
echo "📝  Attaching cache policy to users route (TTL 60 s)"
curl -sf -X POST "$BASE_URL/admin/policies" "${HEADERS[@]}" \
  -d '{
    "route": "users",
    "auth_required": false,
    "cache_ttl_seconds": 60
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

echo "✅  Done! Try it:"
echo "   curl $BASE_URL/users"
echo "   curl $BASE_URL/orders"
echo "   curl $BASE_URL/orders-canary    # Enable FEATURE_CANARY_RELEASES=true for canary splits"
echo "   curl $BASE_URL/admin/upstreams -H 'x-api-key: $ADMIN_KEY'"
