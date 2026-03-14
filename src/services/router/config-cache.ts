import { Route } from '../../models/route.model';
import { Policy } from '../../models/policy.model';
import { RouteRepository } from '../../repositories/route.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { ConfigVersionRepository } from '../../repositories/config-version.repository';
import { env } from '../../config/env';
import { logger } from '../../logger';

// ─── Types ────────────────────────────────────────────────────

export interface CachedConfig {
  /** Enabled routes, sorted longest-prefix-first for O(n) matching */
  routes: Route[];
  /** Map of routeId → Policy for O(1) policy lookup */
  policies: Map<string, Policy>;
  /** Current config version — compared against DB to detect changes */
  version: number;
}

// ─── Singleton cache ──────────────────────────────────────────

let cache: CachedConfig = {
  routes: [],
  policies: new Map(),
  version: 0,
};

let reloadTimer: NodeJS.Timeout | null = null;

const routeRepo = new RouteRepository();
const policyRepo = new PolicyRepository();
const configVersionRepo = new ConfigVersionRepository();

// ─── Public API ───────────────────────────────────────────────

/**
 * Loads routes and policies from DB into memory.
 * Called once at startup and then by the hot-reload timer when the
 * config version advances.
 */
export async function loadConfig(): Promise<void> {
  const [routes, policies, latestVersion] = await Promise.all([
    routeRepo.findEnabled(),
    policyRepo.findAll(),
    configVersionRepo.getLatest(),
  ]);

  const policyMap = new Map<string, Policy>();
  for (const policy of policies) {
    policyMap.set(policy.routeId, policy);
  }

  cache = {
    routes,
    policies: policyMap,
    version: latestVersion?.version ?? 0,
  };

  logger.info(
    { routeCount: routes.length, configVersion: cache.version },
    'Config loaded into memory',
  );
}

/** Returns the current in-memory config snapshot. Zero allocations on hot path. */
export function getConfig(): CachedConfig {
  return cache;
}

/**
 * Starts the background polling loop.
 * Every CONFIG_RELOAD_INTERVAL_MS the gateway compares the latest
 * DB version against the cached version and reloads atomically if changed.
 *
 * Design note from spec: "staggered rollout with versioning" — each instance
 * independently detects the version bump and reloads. No coordination needed
 * because the config is immutable snapshots.
 */
async function checkAndReload(): Promise<void> {
  const latest = await configVersionRepo.getLatest();
  const latestVersion = latest?.version ?? 0;

  if (latestVersion > cache.version) {
    logger.info(
      { from: cache.version, to: latestVersion },
      'Config version advanced — hot-reloading',
    );
    await loadConfig();
  }
}

export function startConfigReload(): void {
  reloadTimer = setInterval(() => {
    checkAndReload().catch((err) => logger.error(err, 'Config hot-reload check failed'));
  }, env.CONFIG_RELOAD_INTERVAL_MS);
}

/** Stops the polling loop — called during graceful shutdown. */
export function stopConfigReload(): void {
  if (reloadTimer) {
    clearInterval(reloadTimer);
    reloadTimer = null;
  }
}
