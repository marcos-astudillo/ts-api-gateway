/**
 * Augments @fastify/request-context to provide typed access
 * to values stored in the per-request AsyncLocalStorage context.
 */
declare module '@fastify/request-context' {
  interface RequestContextData {
    /** W3C Trace-Context compatible request ID, propagated from client or generated */
    traceId: string;
    /** Authenticated user subject claim (set by auth middleware after JWT validation) */
    userId?: string;
  }
}
