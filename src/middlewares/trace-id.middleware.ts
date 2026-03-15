import { randomBytes } from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';

// ─── W3C Trace Context helpers ────────────────────────────────

/**
 * Generates a cryptographically random 64-bit span ID as a 16-char hex string.
 * Used as the gateway's own span ID within the active trace.
 */
function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Parses a W3C Trace Context `traceparent` header.
 * Format: `{version}-{traceId 32hex}-{parentId 16hex}-{flags 2hex}`
 *
 * Returns null on any format violation so we fall back gracefully.
 */
function parseTraceparent(header: string): { traceId: string; parentId: string } | null {
  const parts = header.split('-');
  if (parts.length !== 4 || parts[0] !== '00') return null;
  const [, traceId, parentId] = parts;
  if (!traceId || traceId.length !== 32) return null;
  if (!parentId || parentId.length !== 16) return null;
  return { traceId, parentId };
}

/**
 * Normalises any trace-ID string to a 32-char hex suitable for `traceparent`.
 * UUID v4 strings have dashes stripped; shorter strings are zero-padded.
 */
function normaliseToHex32(id: string): string {
  return id.replace(/-/g, '').padEnd(32, '0').slice(0, 32);
}

// ─── Middleware ───────────────────────────────────────────────

/**
 * Trace ID middleware — runs first in the pipeline.
 *
 * Behaviour:
 *   1. Accepts incoming W3C `traceparent` header — the gateway acts as an
 *      intermediate span and forwards the trace to upstream services.
 *   2. Falls back to `x-request-id` for backwards compatibility with clients
 *      that do not send `traceparent`.
 *   3. Generates a new trace ID if neither header is present.
 *   4. Always sets `traceparent` (W3C), `x-b3-traceid` (Zipkin/B3), and
 *      `x-request-id` in the forwarded request so any downstream service
 *      can participate in the distributed trace.
 *
 * Trace header semantics:
 *   traceparent      — W3C Trace Context; gateway creates a child span
 *   x-b3-traceid     — B3 single-header format; Jaeger + Zipkin compatible
 *   x-b3-spanid      — Gateway's own span ID (the upstream's parent span)
 *   x-b3-sampled     — Always "1" (sampled); adjust for probabilistic tracing
 *   x-request-id     — Legacy human-readable correlation ID (unchanged behaviour)
 */
export function traceIdMiddleware(
  req: FastifyRequest,
  _reply: FastifyReply,
  done: () => void,
): void {
  // ── Step 1: resolve trace ID ─────────────────────────────────

  let traceId: string;
  let traceIdHex: string;

  const incomingTraceparent = req.headers['traceparent'];
  const incomingRequestId   = req.headers['x-request-id'];

  if (typeof incomingTraceparent === 'string') {
    const parsed = parseTraceparent(incomingTraceparent);
    if (parsed) {
      // Continue an existing trace — the caller is the parent span
      traceIdHex = parsed.traceId;
      traceId = traceIdHex; // 32-hex format
    } else {
      // Malformed traceparent — generate a fresh trace
      traceIdHex = randomBytes(16).toString('hex');
      traceId = traceIdHex;
    }
  } else if (typeof incomingRequestId === 'string') {
    // Backwards-compat: use x-request-id as the trace ID
    traceId = incomingRequestId;
    traceIdHex = normaliseToHex32(incomingRequestId);
  } else {
    // No trace headers at all — start a new trace
    traceIdHex = randomBytes(16).toString('hex');
    traceId = traceIdHex;
  }

  // ── Step 2: create gateway span ──────────────────────────────

  const spanId = generateSpanId();

  // ── Step 3: propagate headers ────────────────────────────────

  // W3C Trace Context — gateway becomes the new parent span
  req.headers['traceparent'] = `00-${traceIdHex}-${spanId}-01`;

  // B3 single-header format (Jaeger, Zipkin)
  req.headers['x-b3-traceid'] = traceIdHex;
  req.headers['x-b3-spanid']  = spanId;
  req.headers['x-b3-sampled'] = '1';

  // Legacy correlation header (backwards-compatible; unchanged value semantics)
  req.headers['x-request-id'] = traceId;

  // ── Step 4: store in request context ─────────────────────────

  req.requestContext.set('traceId', traceId);
  req.requestContext.set('spanId', spanId);

  done();
}
