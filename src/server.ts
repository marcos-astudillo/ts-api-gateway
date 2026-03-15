import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './logger';
import type { FastifyInstance } from 'fastify';

async function start(): Promise<void> {
  const app: FastifyInstance = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'API Gateway listening');

  // ── Graceful shutdown ────────────────────────────────────────
  // Wait for in-flight requests to drain before exiting.
  // app.close() triggers the onClose hook → stops timers, closes DB/Redis.
  // Exit code 1 on SIGTERM so Railway/k8s marks the exit as a failure and
  // can restart if the signal was unexpected.  Intentional deploys use SIGTERM
  // then SIGKILL after a grace period, which is fine.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received — draining connections');
    try {
      await app.close();
      logger.info('Server closed gracefully');
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
    }
    // Exit 0 for SIGINT (local Ctrl-C), 0 for SIGTERM (orchestrator stop).
    // Railway treats any exit as a redeploy cycle; using 0 avoids false alerts.
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

// ── Safety net: log unhandled rejections and crash clearly ──────
// Without this, Node.js ≥ 15 crashes with an opaque message and exit code 1.
// With this, the logger emits a structured fatal entry before exit so Railway
// Deploy Logs show exactly which promise rejected and where.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

// Top-level catch ensures startup errors are logged before exit.
start().catch((err) => {
  logger.fatal(err, 'Fatal error during startup');
  process.exit(1);
});
