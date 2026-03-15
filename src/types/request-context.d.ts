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
    /** W3C Trace-Context compatible 128-bit trace ID (32 hex chars or UUID) */
    traceId: string;
    /** Gateway span ID for this hop (16 hex chars, part of traceparent) */
    spanId?: string;
    /** Authenticated user subject claim (set by auth middleware after JWT validation) */
    userId?: string;
    /** Cache key for this request — set by cacheMiddleware when cacheable */
    cacheKey?: string;
    /** Cache TTL in seconds — set alongside cacheKey */
    cacheTtl?: number;
  }
}
