import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';

/**
 * Protects all /admin/* routes with a shared API key.
 * In a real multi-tenant gateway this would be JWT-based with RBAC.
 * The key is sent via the `x-api-key` header.
 */
export function adminAuthMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  const key = req.headers['x-api-key'];
  if (!key || key !== env.ADMIN_API_KEY) {
    void reply.status(401).send({ error: 'Unauthorized — valid x-api-key required' });
  }
}
