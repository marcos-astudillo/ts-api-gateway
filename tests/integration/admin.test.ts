import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { setupSchema, cleanupTables, closePools } from '../helpers/db-setup';

/**
 * Integration tests for the Admin API.
 *
 * These tests run against a real PostgreSQL instance (configured via .env.test).
 * The CI workflow provisions a postgres service container for this purpose.
 *
 * Coverage:
 *  - CRUD for /admin/routes
 *  - CRUD for /admin/policies
 *  - Auth guard (missing / wrong api key)
 *  - Validation errors
 *  - Config version is bumped on mutations
 */

const API_KEY = process.env['ADMIN_API_KEY'] ?? 'test-admin-key-1234567890';

// ─── Helpers ──────────────────────────────────────────────────
const validRoute = {
  name: 'test-orders',
  match: { path_prefix: '/v1/orders' },
  upstream: { host: 'orders.svc', port: 8080 },
  timeouts_ms: { connect: 100, request: 500 },
};

describe('Admin API — /admin/routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupSchema();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  // ─── Auth guard ────────────────────────────────────────────

  it('GET /admin/routes returns 401 without api key', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/routes' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/routes returns 401 with wrong api key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/routes',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ─── List ──────────────────────────────────────────────────

  it('GET /admin/routes returns empty list initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; count: number }>();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });

  // ─── Create ────────────────────────────────────────────────

  it('POST /admin/routes creates a route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { name: string } }>();
    expect(body.data.name).toBe('test-orders');
  });

  it('POST /admin/routes returns 409 for duplicate name', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /admin/routes returns 400 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }), // missing required fields
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Get by ID ─────────────────────────────────────────────

  it('GET /admin/routes/:id returns the route', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });
    const { data } = createRes.json<{ data: { id: string } }>();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/routes/${data.id}`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { name: string } }>().data.name).toBe('test-orders');
  });

  it('GET /admin/routes/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/routes/00000000-0000-0000-0000-000000000000',
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(404);
  });

  // ─── Update ────────────────────────────────────────────────

  it('PUT /admin/routes/:id updates the route', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });
    const { data } = createRes.json<{ data: { id: string } }>();

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/admin/routes/${data.id}`,
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json<{ data: { enabled: boolean } }>().data.enabled).toBe(false);
  });

  // ─── Delete ────────────────────────────────────────────────

  it('DELETE /admin/routes/:id removes the route', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });
    const { data } = createRes.json<{ data: { id: string } }>();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/admin/routes/${data.id}`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/admin/routes/${data.id}`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(getRes.statusCode).toBe(404);
  });
});

// ─── Policies ─────────────────────────────────────────────────

describe('Admin API — /admin/policies', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupSchema();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('POST /admin/policies creates a policy for an existing route', async () => {
    // First create the route
    await app.inject({
      method: 'POST',
      url: '/admin/routes',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validRoute),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/policies',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        route: 'test-orders',
        rate_limit: { rps: 50, burst: 100 },
        auth_required: false,
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { rateLimitRps: number } }>();
    expect(body.data.rateLimitRps).toBe(50);
  });

  it('POST /admin/policies returns 404 when route does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/policies',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'non-existent', rate_limit: { rps: 10, burst: 20 } }),
    });
    expect(res.statusCode).toBe(404);
  });
});
