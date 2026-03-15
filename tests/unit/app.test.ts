import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import type { FastifyInstance } from 'fastify';

/**
 * App bootstrap smoke tests.
 *
 * These run in unit test mode — no real DB or Redis.
 * We mock the infrastructure connections so the tests are fast and isolated.
 */

// Mock DB + Redis so onReady doesn't require real infra
vi.mock('../../src/config/database', () => ({
  db: { end: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) },
  checkDbConnection: vi.fn().mockResolvedValue(true),
  // app.ts onClose now calls closeDb() — must be present in the mock
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/redis', () => ({
  redis: {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    eval: vi.fn(),
    on: vi.fn(),
  },
  checkRedisConnection: vi.fn().mockResolvedValue(true),
  // app.ts onClose now calls closeRedis() — must be present in the mock
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

// Mock config cache so we don't try to query DB
vi.mock('../../src/services/router/config-cache', () => ({
  loadConfig: vi.fn().mockResolvedValue(undefined),
  startConfigReload: vi.fn(),
  stopConfigReload: vi.fn(),
  getConfig: vi.fn().mockReturnValue({ routes: [], policies: new Map(), version: 0 }),
}));

describe('App bootstrap', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 200 when deps are healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe('ready');
  });

  it('GET /metrics returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ requests: { total: number } }>();
    expect(typeof body.requests.total).toBe('number');
  });

  it('GET /admin/routes returns 401 without api key', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/routes' });
    expect(res.statusCode).toBe(401);
  });

  it('unknown paths return 404 from proxy catch-all', async () => {
    const res = await app.inject({ method: 'GET', url: '/v99/unknown' });
    expect(res.statusCode).toBe(404);
  });
});
