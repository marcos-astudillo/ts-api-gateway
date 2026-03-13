import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { requestContext } from '@fastify/request-context';

/**
 * Trace ID middleware — runs first in the pipeline.
 *
 * Behaviour:
 *   1. If the client sends X-Request-ID, that value is reused (enables end-to-end tracing).
 *   2. Otherwise a new UUID v4 is generated.
 *   3. The ID is stored in AsyncLocalStorage (requestContext) and
 *      set on req.headers so downstream middlewares can read it.
 *   4. The proxy will forward this header to upstream services and
 *      echo it back to the client in the response.
 */
export async function traceIdMiddleware(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const incoming = req.headers['x-request-id'];
  const traceId = typeof incoming === 'string' ? incoming : crypto.randomUUID();

  requestContext.set('traceId', traceId);
  // Overwrite so downstream middleware and the proxy see a single consistent value
  req.headers['x-request-id'] = traceId;
}
