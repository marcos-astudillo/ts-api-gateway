import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { setupSchema, cleanupTables, closePools } from '../helpers/db-setup';

/**
 * Integration tests for the proxy engine.
 *
 * Strategy:
 *  1. Start a real upstream HTTP server (Node's http.createServer).
 *  2. Register a gateway route pointing at that upstream via the Admin API.
 *  3. Send requests through the gateway and assert the proxied response.
 *
 * This tests the full stack: route matching → auth → rate limit → circuit breaker → undici proxy.
 */

const API_KEY = process.env['ADMIN_API_KEY'] ?? 'test-admin-key-1234567890';

// ─── Minimal upstream server ──────────────────────────────────
let upstreamPort: number;
let upstreamServer: http.Server;

function startUpstream(): Promise<number> {
  return new Promise((resolve) => {
    upstreamServer = http.createServer((req, res) => {
      const url = req.url ?? '/';

      if (url === '/v1/echo' || url.startsWith('/v1/echo')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echo: true, path: url, method: req.method }));
        return;
      }

      if (url === '/v1/slow') {
        // Simulates a slow upstream — used to test timeouts
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ slow: true }));
        }, 5000);
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    upstreamServer.listen(0, '127.0.0.1', () => {
      const addr = upstreamServer.address() as { port: number };
      resolve(addr.port);
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────

describe('Proxy routing', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupSchema();
    upstreamPort = await startUpstream();

    app = await buildApp();
    await app.ready();

    // Register a route pointing at our upstream
    const routeRes = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'echo',
        match: { path_prefix: '/v1/echo' },
        upstream: { host: '127.0.0.1', port: upstreamPort },
      }),
    });
    expect(routeRes.statusCode).toBe(201);

    // Trigger a config reload so the gateway picks up the new route
    const { loadConfig } = await import('../../src/services/router/config-cache');
    await loadConfig();
  });

  afterEach(async () => {
    // Don't clean routes between tests — reload would be needed
  });

  afterAll(async () => {
    await cleanupTables();
    await app.close();
    await closePools();
    upstreamServer.close();
  });

  it('proxies GET request to upstream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/echo',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ echo: boolean }>();
    expect(body.echo).toBe(true);
  });

  it('preserves request path when proxying', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/echo/something',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ path: string }>();
    expect(body.path).toBe('/v1/echo/something');
  });

  it('echoes X-Request-ID back in response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/echo',
      headers: { 'x-request-id': 'my-trace-123' },
    });
    expect(res.headers['x-request-id']).toBe('my-trace-123');
  });

  it('generates X-Request-ID when not provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/echo',
    });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(typeof res.headers['x-request-id']).toBe('string');
  });

  it('returns 404 with traceId for unknown paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v99/unknown',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ traceId: string }>();
    expect(body.traceId).toBeTruthy();
  });

  it('proxies POST with JSON body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/echo',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ test: 'data' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ method: string }>();
    expect(body.method).toBe('POST');
  });
});

describe('Proxy — no matching route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await cleanupTables();
    await app.close();
    await closePools();
  });

  it('returns 404 when no routes are configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/anything' });
    expect(res.statusCode).toBe(404);
  });
});
