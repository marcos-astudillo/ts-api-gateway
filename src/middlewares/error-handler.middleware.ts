import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../logger';

/**
 * Global Fastify error handler.
 * Catches unhandled errors from route handlers and returns consistent error shapes.
 */
export function errorHandler(
  error: FastifyError,
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  logger.error(
    { err: error, method: req.method, url: req.url },
    'Unhandled request error',
  );

  // Fastify validation errors have a statusCode
  if (error.statusCode) {
    void reply.status(error.statusCode).send({ error: error.message });
    return;
  }

  // PostgreSQL unique constraint violation
  if ((error as unknown as { code: string }).code === '23505') {
    void reply.status(409).send({ error: 'Resource already exists' });
    return;
  }

  void reply.status(500).send({ error: 'Internal Server Error' });
}
