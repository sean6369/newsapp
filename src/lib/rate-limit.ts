/**
 * Client-side pacing for the Gemini free tier.
 *
 * Quotas are per-model, so each caller owns its own limiter rather than
 * sharing one window: relevance scoring on `gemini-3.5-flash-lite` and
 * embedding on `gemini-embedding-2` draw on separate buckets and would
 * throttle each other for no reason if they shared.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RateLimiter {
  /** Resolves once the caller may issue a request without exceeding the window. */
  acquire(): Promise<void>;
}

/**
 * Sliding-window limiter shared by every caller holding the same instance, so
 * concurrent batches can't collectively burst past the quota.
 */
export function createRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const timestamps: number[] = [];

  return {
    async acquire() {
      for (;;) {
        const now = Date.now();
        while (timestamps.length > 0 && now - timestamps[0] >= windowMs) {
          timestamps.shift();
        }
        // No await between the check and the push, so admission is atomic and
        // concurrent callers can't over-admit.
        if (timestamps.length < maxRequests) {
          timestamps.push(now);
          return;
        }
        await sleep(windowMs - (now - timestamps[0]) + 50);
      }
    },
  };
}

export interface TokenLimiter {
  /** Resolves once `tokens` more fit inside the window. */
  acquire(tokens: number): Promise<void>;
}

/**
 * Sliding-window limiter over token volume rather than request count.
 *
 * Embedding is throttled by tokens per minute, not requests: a single batched
 * call carrying 50 articles is one request but tens of thousands of tokens,
 * and pacing it by request count alone sails straight into a 429.
 */
export function createTokenLimiter(maxTokens: number, windowMs: number): TokenLimiter {
  const spent: Array<{ at: number; tokens: number }> = [];

  return {
    async acquire(tokens: number) {
      for (;;) {
        const now = Date.now();
        while (spent.length > 0 && now - spent[0].at >= windowMs) {
          spent.shift();
        }
        const inWindow = spent.reduce((sum, s) => sum + s.tokens, 0);

        // A single request larger than the whole budget would never fit and
        // would spin here forever. Let it through against an empty window and
        // let the server be the judge. Callers should size their requests
        // below the budget so this stays an edge case rather than the norm.
        if (inWindow + tokens <= maxTokens || spent.length === 0) {
          spent.push({ at: now, tokens });
          return;
        }
        await sleep(windowMs - (now - spent[0].at) + 50);
      }
    },
  };
}

/** Rough token count for pacing purposes — English averages ~4 chars/token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Whether a 429 is the *daily* cap rather than a per-minute burst.
 *
 * The two look identical apart from the quota id, and they call for opposite
 * responses: a per-minute rejection clears in seconds and is worth retrying,
 * while a daily one stands until midnight Pacific and will reject every
 * subsequent request just as fast. Telling them apart is what stops a long
 * backfill from spending hours retrying a wall.
 */
export function isDailyQuotaError(body: unknown): boolean {
  const details = (body as {
    error?: { details?: Array<{ violations?: Array<{ quotaId?: string }> }> };
  })?.error?.details;

  return (
    details?.some((d) =>
      d.violations?.some((v) => v.quotaId?.includes("PerDay"))
    ) ?? false
  );
}

/**
 * Gemini 429 responses carry the wait time in `error.details[].retryDelay`
 * (e.g. "48s"). Honour it when present; otherwise back off by `fallbackMs`.
 */
export function parseRetryDelayMs(
  body: unknown,
  fallbackMs: number,
  capMs: number
): number {
  const details = (body as { error?: { details?: Array<{ retryDelay?: string }> } })
    ?.error?.details;
  const retryDelay = details?.find((d) => d.retryDelay)?.retryDelay;
  const match = retryDelay?.match(/([\d.]+)s/);
  if (match) {
    return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 500, capMs);
  }
  return fallbackMs;
}
