import { describe, it, expect } from 'vitest';
import { matchRoute } from '../../src/services/router/route-matcher';
import { Route } from '../../src/models/route.model';

// ─── Helpers ──────────────────────────────────────────────────
function makeRoute(partial: Partial<Route> & { pathPrefix: string }): Route {
  return {
    id: 'test-id',
    name: 'test-route',
    pathPrefix: partial.pathPrefix,
    upstreamHost: 'localhost',
    upstreamPort: 8080,
    stripPath: partial.stripPath ?? false,
    connectTimeoutMs: 200,
    requestTimeoutMs: 2000,
    retries: 2,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

// ─── Tests ────────────────────────────────────────────────────
describe('matchRoute', () => {
  const routes: Route[] = [
    makeRoute({ pathPrefix: '/v1/orders', name: 'orders' }),
    makeRoute({ pathPrefix: '/v1/users', name: 'users' }),
    makeRoute({ pathPrefix: '/v1', name: 'api-v1' }),
  ];

  it('returns null when no route matches', () => {
    expect(matchRoute('/v2/products', routes)).toBeNull();
  });

  it('matches a route by exact prefix', () => {
    const result = matchRoute('/v1/orders', routes);
    expect(result?.route.name).toBe('orders');
  });

  it('matches a route when path has additional segments', () => {
    const result = matchRoute('/v1/orders/123', routes);
    expect(result?.route.name).toBe('orders');
  });

  it('returns most-specific (longest prefix) match first', () => {
    // /v1/orders should win over /v1 for path /v1/orders/456
    const result = matchRoute('/v1/orders/456', routes);
    expect(result?.route.name).toBe('orders');
  });

  it('falls back to shorter prefix when no specific match', () => {
    const result = matchRoute('/v1/products', routes);
    expect(result?.route.name).toBe('api-v1');
  });

  it('does not match partial path segment — /v1/order does NOT match /v1/orders', () => {
    const result = matchRoute('/v1/order', routes);
    // /v1 is the best match, not /v1/orders
    expect(result?.route.name).toBe('api-v1');
  });

  it('upstreamPath equals original path when strip_path is false', () => {
    const result = matchRoute('/v1/orders/123', routes);
    expect(result?.upstreamPath).toBe('/v1/orders/123');
  });

  it('strips prefix from upstreamPath when strip_path is true', () => {
    const strippingRoutes: Route[] = [
      makeRoute({ pathPrefix: '/api', name: 'api', stripPath: true }),
    ];
    const result = matchRoute('/api/users/42', strippingRoutes);
    expect(result?.upstreamPath).toBe('/users/42');
  });

  it('upstreamPath is "/" when stripping an exact-prefix match', () => {
    const strippingRoutes: Route[] = [
      makeRoute({ pathPrefix: '/api', name: 'api', stripPath: true }),
    ];
    const result = matchRoute('/api', strippingRoutes);
    expect(result?.upstreamPath).toBe('/');
  });

  it('returns null for empty routes array', () => {
    expect(matchRoute('/v1/orders', [])).toBeNull();
  });
});
