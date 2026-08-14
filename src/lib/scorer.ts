import { USER_INTERESTS } from "./interests";
import { GEMINI_API_KEY, geminiUrl } from "./gemini";
import {
  createRateLimiter,
  isDailyQuotaError,
  parseRetryDelayMs,
  sleep,
} from "./rate-limit";

// gemini-3.5-flash-lite free tier allows 15 requests/minute per model. Pace
// every scoring call through one shared sliding window (with a small margin)
// so concurrent callers — pipeline batches, backfill, rescore scripts — can't
// collectively burst past the quota. Embedding runs on a different model and
// so a different quota; see `embeddings.ts` for its own limiter.
const WINDOW_MS = 60_000;
const scoringLimiter = createRateLimiter(14, WINDOW_MS);

/**
 * The quota day on which scoring hit the daily cap, or null.
 *
 * Per-minute rejections are worth retrying; the daily cap is not, and
 * `parseRetryDelayMs` caps its multi-hour `retryDelay` at `WINDOW_MS` — so
 * without this every remaining article spends its retries against a wall that
 * will not move before midnight. A 300-article day grinds for hours and the
 * next hourly run repeats it.
 *
 * Keyed by Pacific day because that is when Gemini's daily quotas reset (see
 * `isDailyQuotaError`), not `ARCHIVE_TZ`. Getting the boundary slightly wrong
 * is self-correcting: resuming early just re-latches on the next 429.
 */
let quotaExhaustedOn: string | null = null;

function quotaDay(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

/**
 * Whether today's scoring allowance is already spent.
 *
 * Lets a caller skip work it would only throw away — the pipeline's catch-up
 * pass checks this before querying for articles to repair, the same way the
 * embedding catch-up checks `quotaExhausted`.
 */
export function isScoringQuotaExhausted(): boolean {
  return quotaExhaustedOn === quotaDay();
}

export async function scoreArticle(
  article: {
    title: string;
    summary: string;
    category: string;
    feed: string;
  },
  model?: string
): Promise<number | null> {
  // Checked before the limiter, not after: acquiring first would make every
  // remaining article wait its turn in the 14/min queue only to give up.
  if (isScoringQuotaExhausted()) return null;

  const prompt = `You are a news relevance scorer. Rate this article on 4 dimensions with the given ranges.
Do NOT round scores to multiples of 5 — use precise values like 17, 23, 6.
Use the full range of each dimension: give low scores to weak matches and high scores to strong ones.

DIMENSIONS:
- Relevance (0-40): How closely does this match the user's stated interests? (0 = completely unrelated, 40 = core interest)
- Impact (0-25): How significant or consequential is this news? (0 = trivial, 25 = major/breaking)
- Uniqueness (0-10): How novel or surprising is this? (0 = routine/expected, 10 = unprecedented)
- Actionability (0-25): How useful is it for the user to know this right now? (0 = no urgency, 25 = must-know)

USER INTERESTS:
${USER_INTERESTS}

ARTICLE:
Title: ${article.title}
Summary: ${article.summary}
Category: ${article.category}
Feed: ${article.feed}

Respond with ONLY four integers separated by commas (e.g. "28,17,6,22"). No other text.`;

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await scoringLimiter.acquire();

      const response = await fetch(`${geminiUrl("generateContent", model)}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 512,
            temperature: 0,
            thinkingConfig: { thinkingBudget: 256 },
          },
        }),
      });

      // Retry rate-limit rejections using the delay the API asks for. With the
      // client-side limiter this should be rare (clock skew / shared quota).
      // The daily cap is tested first and on every attempt — the old guard
      // skipped this branch entirely on the last one, so the one rejection
      // most worth recognising was the one that went unread.
      if (response.status === 429) {
        const body = await response.json().catch(() => null);

        if (isDailyQuotaError(body)) {
          quotaExhaustedOn = quotaDay();
          console.warn(
            "[scorer] Daily quota exhausted — scoring stops until it resets; unscored articles stay null for a later run"
          );
          return null;
        }

        if (attempt < MAX_ATTEMPTS) {
          const waitMs = parseRetryDelayMs(body, 5000, WINDOW_MS);
          console.warn(
            `[scorer] Rate limited (429), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS - 1})`
          );
          await sleep(waitMs);
          continue;
        }
      }

      if (!response.ok) {
        console.error(`[scorer] Gemini API error ${response.status}`);
        return null;
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts;

      // Gemini thinking models return the thought as an earlier part — the
      // actual answer is the last non-thought part.
      const text = parts
        ?.filter((p: { thought?: boolean }) => !p.thought)
        ?.pop()?.text?.trim();

      if (!text) {
        console.error("[scorer] No text in Gemini response");
        return null;
      }

      // Parse four comma-separated integers
      const nums = text.match(/(\d+)/g)?.map(Number);
      const maxPerDim = [40, 25, 10, 25];
      if (
        !nums ||
        nums.length !== 4 ||
        nums.some((n: number, i: number) => n < 0 || n > maxPerDim[i])
      ) {
        console.error(`[scorer] Invalid response: "${text}"`);
        return null;
      }

      const total = nums[0] + nums[1] + nums[2] + nums[3];
      // Convert 0-100 to 0.0-10.0 with 1 d.p.
      return Math.round(total) / 10;
    } catch (error) {
      console.error("[scorer] Error scoring article:", error);
      return null;
    }
  }

  return null;
}
