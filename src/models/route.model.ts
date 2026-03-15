/**
 * Domain model for a gateway route.
 * Stored in the `routes` table and cached in memory for fast matching.
 */
export interface Route {
  id: string;
  name: string;
  pathPrefix: string;
  upstreamHost: string;
  upstreamPort: number;
  stripPath: boolean;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  retries: number;
  enabled: boolean;
  /** Canary upstream host — null when canary is not configured */
  canaryUpstreamHost: string | null;
  /** Canary upstream port — null when canary is not configured */
  canaryUpstreamPort: number | null;
  /** Percentage of traffic (0–100) routed to the canary upstream */
  canaryWeight: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape expected by POST /admin/routes (matches design doc API) */
export interface CreateRouteDto {
  name: string;
  match: {
    path_prefix: string;
  };
  upstream: {
    host: string;
    port: number;
  };
  strip_path?: boolean;
  timeouts_ms?: {
    connect?: number;
    request?: number;
  };
  retries?: number;
  /** Optional canary traffic splitting configuration */
  canary?: {
    upstream: {
      host: string;
      port: number;
    };
    /** Percentage of traffic (1–100) sent to the canary upstream */
    weight: number;
  };
}

export type UpdateRouteDto = Partial<CreateRouteDto> & { enabled?: boolean };
