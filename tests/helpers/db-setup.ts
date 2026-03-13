/**
 * Test DB helpers.
 *
 * Sets up and tears down database schema for integration tests.
 * Uses the DATABASE_URL from the test environment (.env.test).
 */
import { Pool } from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests');
}

export const testDb = new Pool({ connectionString: DATABASE_URL });

export async function setupSchema(): Promise<void> {
  await testDb.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS routes (
      id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      name               VARCHAR(255) UNIQUE NOT NULL,
      path_prefix        VARCHAR(255) NOT NULL,
      upstream_host      VARCHAR(255) NOT NULL,
      upstream_port      INTEGER      NOT NULL DEFAULT 80,
      strip_path         BOOLEAN      NOT NULL DEFAULT false,
      connect_timeout_ms INTEGER      NOT NULL DEFAULT 200,
      request_timeout_ms INTEGER      NOT NULL DEFAULT 2000,
      retries            INTEGER      NOT NULL DEFAULT 2,
      enabled            BOOLEAN      NOT NULL DEFAULT true,
      created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS policies (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id         UUID        NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      auth_required    BOOLEAN     NOT NULL DEFAULT false,
      rate_limit_rps   INTEGER,
      rate_limit_burst INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (route_id)
    );

    CREATE TABLE IF NOT EXISTS config_versions (
      id           SERIAL      PRIMARY KEY,
      version      INTEGER     NOT NULL,
      checksum     VARCHAR(64) NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function cleanupTables(): Promise<void> {
  await testDb.query(`
    TRUNCATE config_versions, policies, routes RESTART IDENTITY CASCADE;
  `);
}

export async function closePools(): Promise<void> {
  await testDb.end();
}
