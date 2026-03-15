import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * All environment variables are validated at startup using Zod.
 * If a required variable is missing the process will exit immediately
 * with a clear error message — fail fast, never silently misconfigure.
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Auth
  JWKS_URI: z.string().url().optional(),
  JWT_AUDIENCE: z.string().default('api-gateway'),
  JWT_ISSUER: z.string().optional(),
  JWKS_CACHE_TTL_SECONDS: z.coerce.number().default(600),

  // Rate limiting
  RATE_LIMIT_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  RATE_LIMIT_DEFAULT_RPS: z.coerce.number().default(100),
  RATE_LIMIT_DEFAULT_BURST: z.coerce.number().default(200),

  // Feature flags
  FEATURE_CANARY_RELEASES: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  FEATURE_ANALYTICS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Admin API
  ADMIN_API_KEY: z.string().min(16),

  // Config hot reload
  CONFIG_RELOAD_INTERVAL_MS: z.coerce.number().default(5000),

  // Circuit breaker
  CIRCUIT_BREAKER_TIMEOUT_MS: z.coerce.number().default(3000),
  CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT: z.coerce.number().default(50),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().default(10000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
