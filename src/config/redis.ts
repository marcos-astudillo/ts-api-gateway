import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  // lazyConnect=true means we call redis.connect() explicitly in app onReady hook
  lazyConnect: true,
});

redis.on('error', (err) => {
  logger.error(err, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('reconnecting', () => {
  logger.warn('Redis reconnecting...');
});

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
