import { request as undiciRequest, Dispatcher } from 'undici';
import { Route } from '../../models/route.model';
import { logger } from '../../logger';

// ─── Types ────────────────────────────────────────────────────

export interface ProxyOptions {
  route: Route;
  upstreamPath: string;
  method: string;
  /** Original request headers (hop-by-hop headers are stripped before forwarding) */
  headers: Record<string, string | string[] | undefined>;
  /** Raw request body buffer (undefined for GET/HEAD/OPTIONS) */
  body?: Buffer;
  traceId: string;
  queryString: string;
}

export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  upstreamLatencyMs: number;
}

// ─── Hop-by-hop headers (must not be forwarded) ───────────────
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'host', // rewritten by undici to upstream host
]);

// ─── Core proxy function ──────────────────────────────────────

/**
 * Forwards an HTTP request to an upstream service using undici.
 *
 * Features:
 *  - Strips hop-by-hop headers
 *  - Injects X-Request-ID and X-Forwarded-By
 *  - Respects per-route connect and request timeouts
 *  - Measures upstream latency for metrics/SLOs
 */
export async function proxyRequest(options: ProxyOptions): Promise<ProxyResult> {
  const { route, upstreamPath, method, headers, body, traceId, queryString } = options;

  const qs = queryString ? `?${queryString}` : '';
  const url = `http://${route.upstreamHost}:${route.upstreamPort}${upstreamPath}${qs}`;

  // Build clean headers for upstream
  const forwardHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && value !== undefined) {
      forwardHeaders[key] = value;
    }
  }
  forwardHeaders['x-request-id'] = traceId;
  forwardHeaders['x-forwarded-by'] = 'ts-api-gateway';

  const start = Date.now();

  try {
    const response = await undiciRequest(url, {
      method: method as Dispatcher.HttpMethod,
      headers: forwardHeaders,
      body: body?.length ? body : undefined,
      // undici separates connect timeout (headersTimeout) from body timeout (bodyTimeout)
      headersTimeout: route.connectTimeoutMs,
      bodyTimeout: route.requestTimeoutMs,
    });

    const upstreamLatencyMs = Date.now() - start;
    const responseBody = Buffer.from(await response.body.arrayBuffer());

    // Build response headers — always echo trace ID back to client
    const responseHeaders: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        responseHeaders[key] = value;
      }
    }
    responseHeaders['x-request-id'] = traceId;

    logger.debug(
      { url, method, statusCode: response.statusCode, upstreamLatencyMs },
      'Upstream response received',
    );

    return {
      statusCode: response.statusCode,
      headers: responseHeaders,
      body: responseBody,
      upstreamLatencyMs,
    };
  } catch (err) {
    const upstreamLatencyMs = Date.now() - start;
    logger.error({ url, method, upstreamLatencyMs, err }, 'Upstream request failed');
    throw err;
  }
}
