import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../logger';

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  // Railway and most cloud DBs require SSL in production
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

db.on('error', (err) => {
  logger.error(err, 'Unexpected database pool error');
});

/**
 * Checks DB connectivity — used by /readyz health endpoint.
 */
export async function checkDbConnection(): Promise<boolean> {
  try {
    const client = await db.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}
