const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * Runs `fn` up to `maxAttempts` times with exponential back-off between
 * failures. On the final attempt the last error is re-thrown so callers can
 * wrap it in an appropriate Left / error value.
 *
 * Delays (with default 500 ms base): 500 ms → 1 000 ms → …
 * Only the sleep between attempts is delayed; the first call is immediate.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    label: string;
    maxAttempts?: number;
    baseDelayMs?: number;
  },
): Promise<T> {
  const {
    label,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `[ContextModule] ${label}: attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms`,
          error,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
