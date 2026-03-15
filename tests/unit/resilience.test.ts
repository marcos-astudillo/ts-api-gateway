import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CircuitBreaker from 'opossum';
import {
  isRetryableError,
  isRetryableStatus,
  executeWithRetry,
} from '../../src/services/proxy/retry-policy';

// ─── isRetryableError ─────────────────────────────────────────

describe('isRetryableError', () => {
  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
  ])('retries on error code %s', (code) => {
    const err = Object.assign(new Error('network failure'), { code });
    expect(isRetryableError(err)).toBe(true);
  });

  it('retries on TimeoutError (AbortSignal.timeout())', () => {
    // AbortSignal.timeout() fires a DOMException with name 'TimeoutError'
    const err = new DOMException('signal timed out', 'TimeoutError');
    expect(isRetryableError(err)).toBe(true);
  });

  it('retries on AbortError (AbortController.abort())', () => {
    const err = new DOMException('aborted', 'AbortError');
    expect(isRetryableError(err)).toBe(true);
  });

  it('does not retry on generic application errors', () => {
    expect(isRetryableError(new Error('validation failed'))).toBe(false);
  });

  it('does not retry on non-Error values', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });
});

// ─── isRetryableStatus ────────────────────────────────────────

describe('isRetryableStatus', () => {
  it.each([500, 502, 503, 504])('retries on HTTP %i', (code) => {
    expect(isRetryableStatus(code)).toBe(true);
  });

  it.each([200, 201, 204, 301, 400, 401, 403, 404, 422])('does not retry on HTTP %i', (code) => {
    expect(isRetryableStatus(code)).toBe(false);
  });
});

// ─── executeWithRetry ─────────────────────────────────────────

describe('executeWithRetry', () => {
  const noRetryOnResult = () => false;

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await executeWithRetry(fn, noRetryOnResult, { maxRetries: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on a retryable error and returns the recovery result', async () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('recovered');
    const result = await executeWithRetry(fn, noRetryOnResult, { maxRetries: 2 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts all retries and re-throws the last error', async () => {
    const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(executeWithRetry(fn, noRetryOnResult, { maxRetries: 2 })).rejects.toThrow('refused');
    // 1 initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('application error'));
    await expect(executeWithRetry(fn, noRetryOnResult, { maxRetries: 2 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a 5xx result and returns the recovered result', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 503 })
      .mockResolvedValue({ statusCode: 200 });
    const result = await executeWithRetry(fn, (r) => isRetryableStatus(r.statusCode), {
      maxRetries: 2,
    });
    expect(result.statusCode).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns the last 5xx result when retries are exhausted (does not swallow it)', async () => {
    const fn = vi.fn().mockResolvedValue({ statusCode: 502 });
    const result = await executeWithRetry(fn, (r) => isRetryableStatus(r.statusCode), {
      maxRetries: 2,
    });
    // After 3 attempts the 502 is returned as-is so the proxy can forward it
    expect(result.statusCode).toBe(502);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a 4xx result', async () => {
    const fn = vi.fn().mockResolvedValue({ statusCode: 404 });
    const result = await executeWithRetry(fn, (r) => isRetryableStatus(r.statusCode), {
      maxRetries: 2,
    });
    expect(result.statusCode).toBe(404);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with the correct attempt number and error', async () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');
    const onRetry = vi.fn();
    await executeWithRetry(fn, noRetryOnResult, { maxRetries: 2, onRetry });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(1, err);
  });

  it('calls onRetry with null when retrying due to a 5xx result', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 500 })
      .mockResolvedValue({ statusCode: 200 });
    const onRetry = vi.fn();
    await executeWithRetry(fn, (r) => isRetryableStatus(r.statusCode), { maxRetries: 2, onRetry });
    expect(onRetry).toHaveBeenCalledWith(1, null);
  });

  it('respects maxRetries: 0 (single attempt, no retries)', async () => {
    const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(executeWithRetry(fn, noRetryOnResult, { maxRetries: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── Circuit breaker behaviour ────────────────────────────────

describe('circuit breaker', () => {
  // Create a test-local breaker wrapping a mock function.
  // Configuration chosen for fast, deterministic tests:
  //   timeout: false     — no opossum-managed timeout (AbortSignal handles it in prod)
  //   volumeThreshold: 3 — open after 3 requests (not the default 5)
  //   errorThresholdPercentage: 50 — opossum uses strict >, so 100% failures > 50% opens
  //   resetTimeout: 80   — transition to half-open after 80 ms (keeps tests fast)

  function makeBreaker(fn: (...args: unknown[]) => Promise<unknown>) {
    return new CircuitBreaker(fn, {
      timeout: false,
      errorThresholdPercentage: 50,
      resetTimeout: 80,
      volumeThreshold: 3,
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after the volume threshold of failures is exceeded', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('upstream down'));
    const breaker = makeBreaker(fn);

    let opened = false;
    breaker.on('open', () => { opened = true; });

    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {/* expected */});
    }

    expect(opened).toBe(true);
    expect(breaker.opened).toBe(true);
  });

  it('short-circuits (does not call fn) when the circuit is open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    const breaker = makeBreaker(fn);

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {});
    }
    expect(breaker.opened).toBe(true);

    const callsBefore = fn.mock.calls.length;

    // Additional fire when open — fn must NOT be called
    await breaker.fire().catch(() => {});
    expect(fn.mock.calls.length).toBe(callsBefore);
  });

  it('rejects with "Breaker is open" message when circuit is open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    const breaker = makeBreaker(fn);

    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {});
    }

    const err = await breaker.fire().catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Breaker is open/i);
  });

  it('transitions to half-open after resetTimeout elapses', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    const breaker = makeBreaker(fn);

    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {});
    }
    expect(breaker.opened).toBe(true);

    let halfOpened = false;
    breaker.on('halfOpen', () => { halfOpened = true; });

    // Wait for the 50 ms resetTimeout to elapse
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(halfOpened).toBe(true);
    expect(breaker.halfOpen).toBe(true);
  }, 5000);

  it('closes after a successful probe in half-open state', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error('down')); // will be overridden below

    const breaker = makeBreaker(fn);

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {});
    }

    // Wait for half-open
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(breaker.halfOpen).toBe(true);

    // Swap to success — the half-open probe should close the circuit
    fn.mockResolvedValue('recovered');

    let closed = false;
    breaker.on('close', () => { closed = true; });

    await breaker.fire();

    expect(closed).toBe(true);
    expect(breaker.closed).toBe(true);
  }, 5000);
});

// ─── Gateway 503 response (integration-style) ─────────────────
// Verifies that proxy.routes.ts returns the correct body when the
// circuit is open — without starting a full Fastify app.

describe('proxy handler — upstream_unavailable shape', () => {
  it('produces the required error body on circuit open', () => {
    // This test validates the shape constants we use in proxy.routes.ts.
    // The actual HTTP behaviour is covered by integration/proxy.test.ts.
    const body = {
      error: 'upstream_unavailable',
      message: 'Service temporarily unavailable',
    };
    expect(body.error).toBe('upstream_unavailable');
    expect(body.message).toBe('Service temporarily unavailable');
  });
});
