import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../logger';

function makeRedis(): Redis {
  const instance = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    // lazyConnect=true means we call redis.connect() explicitly in app onReady hook
    lazyConnect: true,
  });

  instance.on('error', (err) => {
    logger.error(err, 'Redis connection error');
  });

  instance.on('connect', () => {
    logger.info('Redis connected');
  });

  instance.on('reconnecting', () => {
    logger.warn('Redis reconnecting...');
  });

  return instance;
}

// `let` so closeRedis() can swap in a fresh instance after shutdown.
// Mirrors the closeDb() pattern in database.ts — after ioredis.quit() the
// instance is in 'end' state and cannot be reconnected; a new instance must
// be created before the next buildApp() call.
export let redis: Redis = makeRedis();

/**
 * Graceful shutdown: quits the current Redis connection then installs a
 * fresh lazy-connect instance. Called by app.ts onClose so that the next
 * buildApp() (e.g. second describe block in integration tests) starts clean.
 */
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    // Connection may have already closed — safe to ignore.
  }
  redis = makeRedis();
}

/**
 * Checks Redis connectivity — used by /readyz health endpoint.
 */
export async function checkRedisConnection(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
