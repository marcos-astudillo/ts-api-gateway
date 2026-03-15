/**
 * Domain model for a route policy.
 * One policy per route (1:1 relationship via UNIQUE route_id constraint).
 * Controls authentication requirements and per-route rate limits.
 */
export interface Policy {
  id: string;
  routeId: string;
  authRequired: boolean;
  rateLimitRps: number | null;
  rateLimitBurst: number | null;
  /** Per-route response cache TTL in seconds (null = use global default) */
  cacheTtlSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape expected by POST /admin/policies (matches design doc API) */
export interface CreatePolicyDto {
  /** Route name (looked up to resolve route_id) */
  route: string;
  auth_required?: boolean;
  rate_limit?: {
    rps: number;
    burst: number;
  };
  /** Per-route response cache TTL in seconds (0 or omit to disable) */
  cache_ttl_seconds?: number;
}
