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
}

export type UpdateRouteDto = Partial<CreateRouteDto> & { enabled?: boolean };
