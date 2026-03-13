import { Route } from '../../models/route.model';

export interface MatchResult {
  route: Route;
  /** The path that will be sent to the upstream service */
  upstreamPath: string;
}

/**
 * Finds the most-specific matching route for an incoming request path.
 *
 * Matching strategy:
 *   - Path-prefix matching: /v1/orders matches /v1/orders/123
 *   - Most-specific wins: /v1/orders/premium is preferred over /v1/orders
 *   - Routes must already be sorted longest-prefix-first (done by DB query)
 *
 * strip_path behaviour:
 *   - true  → upstream sees only the suffix after the prefix
 *             e.g. prefix=/api, incoming=/api/users → upstream=/users
 *   - false → upstream sees the full path (default)
 *
 * @example
 *   matchRoute('/v1/orders/123', routes) → { route, upstreamPath: '/v1/orders/123' }
 */
export function matchRoute(path: string, routes: Route[]): MatchResult | null {
  for (const route of routes) {
    if (!path.startsWith(route.pathPrefix)) continue;

    // Ensure we match full path segments, not partial words.
    // /v1/order should NOT match /v1/orders prefix.
    const afterPrefix = path.slice(route.pathPrefix.length);
    if (afterPrefix !== '' && !afterPrefix.startsWith('/')) continue;

    const upstreamPath = route.stripPath
      ? afterPrefix || '/'
      : path;

    return { route, upstreamPath };
  }
  return null;
}
