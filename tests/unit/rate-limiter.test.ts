import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Rate limiter unit tests use a mocked Redis client.
 * Integration tests (tests/integration/) use a real Redis instance.
 *
 * We test:
 *  - Requests within the limit are allowed
 *  - Requests exceeding the burst are denied
 *  - Fail-open behaviour when Redis throws
 */

// ─── Mock Redis ───────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories are executed,
// so `mockEval` is defined by the time the factory body runs.
const { mockEval } = vi.hoisted(() => ({ mockEval: vi.fn() }));

vi.mock('../../src/config/redis', () => ({
  redis: {
    eval: mockEval,
  },
}));

// Import AFTER mock is set up
import { checkRateLimit } from '../../src/services/ratelimit/rate-limiter.service';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns allowed=true when Redis returns [1, remaining]', async () => {
    mockEval.mockResolvedValueOnce([1, 49]);

    const result = await checkRateLimit('orders', '127.0.0.1', 50, 50);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(49);
    expect(result.limit).toBe(50);
  });

  it('returns allowed=false when Redis returns [0, 0]', async () => {
    mockEval.mockResolvedValueOnce([0, 0]);

    const result = await checkRateLimit('orders', '127.0.0.1', 50, 50);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('uses burst as the window limit', async () => {
    mockEval.mockResolvedValueOnce([1, 99]);

    const result = await checkRateLimit('orders', '127.0.0.1', 50, 100);

    expect(result.limit).toBe(100); // burst, not rps
    expect(result.allowed).toBe(true);
  });

  it('fails open when Redis throws — allows the request', async () => {
    mockEval.mockRejectedValueOnce(new Error('Redis connection refused'));

    const result = await checkRateLimit('orders', '127.0.0.1', 50, 50);

    expect(result.allowed).toBe(true);
  });

  it('returns non-negative remaining even if Redis returns negative value', async () => {
    mockEval.mockResolvedValueOnce([1, -5]);

    const result = await checkRateLimit('orders', '127.0.0.1', 50, 50);

    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it('uses the correct Redis key format: rl:{route}:{client}', async () => {
    mockEval.mockResolvedValueOnce([1, 9]);

    await checkRateLimit('my-route', 'user-abc', 10, 10);

    // First arg to eval is the script, second is key count, third is the key
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1,
      'rl:my-route:user-abc',
      expect.any(Number), // now
      expect.any(Number), // windowMs
      10,                 // burst (limit)
    );
  });
});
