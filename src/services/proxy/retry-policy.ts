/**
 * Pure retry policy utilities — no I/O, no side effects.
 *
 * Separation of concerns:
 *  - This module decides *whether* to retry and *how many times*.
 *  - Logging and metrics are the caller's responsibility (via onRetry).
 *  - circuit-breaker.ts wraps upstream-client.ts, which wraps executeWithRetry.
 *    The circuit breaker therefore sees the final outcome after all retries —
 *    transient errors that heal within the retry budget are invisible to it.
 */

// ─── Retryable error detection ────────────────────────────────

/**
 * Low-level OS / undici error codes that indicate a transient network failure.
 * These errors are safe to retry because no bytes were committed to the upstream.
 */
const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',   // upstream not listening
  'ECONNRESET',     // upstream closed the connection mid-flight
  'ETIMEDOUT',      // OS-level TCP connect timeout
  'EPIPE',          // write on a half-closed connection
  'ENOTFOUND',      // DNS resolution failure (transient in some envs)
  // undici-specific codes
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Returns true when the thrown error represents a transient failure that is
 * safe to retry (no partial write committed to the upstream).
 *
 * Also retries on AbortError / TimeoutError produced by AbortSignal.timeout(),
 * which is used in upstream-client.ts as the hard per-attempt wall-clock limit.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // AbortSignal.timeout() fires a DOMException with name 'TimeoutError'.
  // AbortController.abort() fires a DOMException with name 'AbortError'.
  // Both indicate the request did not complete — safe to retry.
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;

  const code = (err as NodeJS.ErrnoException).code ?? '';
  return RETRYABLE_CODES.has(code);
}

/**
 * Returns true when the upstream HTTP status code warrants a retry.
 * 5xx codes indicate a server-side failure that may be transient
 * (overload, rolling restart, etc.).
 */
export function isRetryableStatus(statusCode: number): boolean {
  return statusCode >= 500;
}

// ─── Retry executor ───────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of additional attempts after the first (total = maxRetries + 1). */
  maxRetries: number;
  /**
   * Called before each retry attempt.
   * @param attempt  1-based retry number
   * @param err      The error/null that triggered the retry (null for 5xx result retries)
   */
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * Executes `fn` up to `maxRetries + 1` times total.
 *
 * Retry is triggered when:
 *  a) `fn` throws and `isRetryableError(err)` is true, OR
 *  b) `fn` resolves and `shouldRetryOnResult(result)` is true (e.g. 5xx status)
 *
 * On the final attempt the result/error is returned/thrown unconditionally,
 * so the caller always receives the last upstream response rather than silence.
 *
 * The circuit breaker wraps the *entire* call to executeWithRetry so that only
 * exhausted failures (not individual transient attempts) count against the breaker.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  shouldRetryOnResult: (result: T) => boolean,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, onRetry } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      // Return on success OR when retries are exhausted (pass final 5xx to caller)
      if (!shouldRetryOnResult(result) || attempt === maxRetries) {
        return result;
      }

      // Result is retryable (e.g. 5xx) and we still have budget left
      onRetry?.(attempt + 1, null);
    } catch (err) {
      // Non-retryable error, or budget exhausted — propagate immediately
      if (!isRetryableError(err) || attempt === maxRetries) {
        throw err;
      }

      onRetry?.(attempt + 1, err);
    }
  }

  // Unreachable: the loop always returns or throws before the last iteration ends.
  // Required by TypeScript's control-flow analysis.
  throw new Error('executeWithRetry: exhausted without result');
}
