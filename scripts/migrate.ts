/**
 * Database migration runner.
 * Run with: npm run db:migrate
 *
 * Each migration is versioned and idempotent — safe to run multiple times.
 * Migrations are applied in order; already-applied ones are skipped.
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_schema_migrations',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    version: 2,
    name: 'create_routes',
    sql: `
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
      CREATE INDEX IF NOT EXISTS idx_routes_path_prefix ON routes(path_prefix);
      CREATE INDEX IF NOT EXISTS idx_routes_enabled     ON routes(enabled);
    `,
  },
  {
    version: 3,
    name: 'create_policies',
    sql: `
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
      CREATE INDEX IF NOT EXISTS idx_policies_route_id ON policies(route_id);
    `,
  },
  {
    version: 4,
    name: 'create_config_versions',
    sql: `
      CREATE TABLE IF NOT EXISTS config_versions (
        id           SERIAL      PRIMARY KEY,
        version      INTEGER     NOT NULL,
        checksum     VARCHAR(64) NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_config_versions_version
        ON config_versions(version DESC);
    `,
  },
  {
    version: 5,
    name: 'add_canary_columns_to_routes',
    sql: `
      ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS canary_upstream_host VARCHAR(255),
        ADD COLUMN IF NOT EXISTS canary_upstream_port INTEGER,
        ADD COLUMN IF NOT EXISTS canary_weight        INTEGER
          CHECK (canary_weight IS NULL OR (canary_weight >= 0 AND canary_weight <= 100));
    `,
  },
  {
    version: 6,
    name: 'add_cache_ttl_to_policies',
    sql: `
      ALTER TABLE policies
        ADD COLUMN IF NOT EXISTS cache_ttl_seconds INTEGER;
    `,
  },
];

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Always create migrations table first (it's its own migration)
    await client.query(migrations[0]!.sql);

    for (const migration of migrations.slice(1)) {
      const { rows } = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [migration.version],
      );

      if (rows.length > 0) {
        console.log(`  ↩  Migration ${migration.version} (${migration.name}) already applied`);
        continue;
      }

      console.log(`  ⬆  Applying migration ${migration.version}: ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name],
        );
        await client.query('COMMIT');
        console.log(`  ✓  Migration ${migration.version} applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('\n✅  All migrations complete\n');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('❌  Migration failed:', err);
  process.exit(1);
});
