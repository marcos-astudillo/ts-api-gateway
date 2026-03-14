/**
 * Augments @fastify/request-context to provide typed access
 * to values stored in the per-request AsyncLocalStorage context.
 *
 * The import is required so TypeScript resolves this as a module-scoped
 * augmentation (not an ambient global), ensuring the merged interface
 * is picked up by @fastify/request-context's RequestContext.get/set types.
 */
import '@fastify/request-context';

declare module '@fastify/request-context' {
  interface RequestContextData {
    /** W3C Trace-Context compatible request ID, propagated from client or generated */
    traceId: string;
    /** Authenticated user subject claim (set by auth middleware after JWT validation) */
    userId?: string;
  }
}
