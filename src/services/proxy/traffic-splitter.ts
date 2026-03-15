import { Route } from '../../models/route.model';

// ─── Types ────────────────────────────────────────────────────

export interface UpstreamTarget {
  host: string;
  port: number;
  /** Which variant was selected — useful for metrics and logging */
  variant: 'stable' | 'canary';
}

// ─── Weighted random selection ────────────────────────────────

/**
 * Selects an upstream target for a given route.
 *
 * When canary is fully configured (host + port + weight > 0):
 *   - A random number in [0, 100) is drawn.
 *   - If it falls below canaryWeight → canary upstream is selected.
 *   - Otherwise → stable upstream.
 *
 * This implements a stateless, per-request weighted coin flip.
 * For sticky sessions (same user always sees canary), key the random
 * decision on req.requestContext.get('userId') % 100 instead.
 *
 * @example
 *   route.canaryWeight = 10  → ~10 % of traffic hits the canary
 *   route.canaryWeight = 0   → all traffic hits stable (canary off)
 */
export function selectUpstream(route: Route): UpstreamTarget {
  const hasCanary =
    route.canaryUpstreamHost != null &&
    route.canaryUpstreamPort != null &&
    (route.canaryWeight ?? 0) > 0;

  if (hasCanary) {
    const roll = Math.random() * 100;
    if (roll < (route.canaryWeight ?? 0)) {
      return {
        host: route.canaryUpstreamHost!,
        port: route.canaryUpstreamPort!,
        variant: 'canary',
      };
    }
  }

  return {
    host: route.upstreamHost,
    port: route.upstreamPort,
    variant: 'stable',
  };
}
