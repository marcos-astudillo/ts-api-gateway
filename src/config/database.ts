import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../logger';

function makePool(): Pool {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
    // Railway and most cloud DBs require SSL in production
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    logger.error(err, 'Unexpected database pool error');
  });

  return pool;
}

// `let` so closeDb() can swap in a fresh pool after shutdown.
// In CommonJS (compiled output) every import reads `module.exports.db`
// on each access, so the new pool is immediately visible to all repositories.
export let db: Pool = makePool();

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

/**
 * Graceful shutdown: drains the current pool then installs a fresh one.
 *
 * Re-creating the pool ensures that if another Fastify instance is started
 * in the same process (e.g. integration-test isolation across describe blocks),
 * subsequent DB queries do not hit an already-closed pool.
 */
export async function closeDb(): Promise<void> {
  try {
    await db.end();
  } catch {
    // Pool may have already been ended — safe to ignore.
  }
  db = makePool();
}
