import { USER_INTERESTS } from "./interests";
import { GEMINI_API_KEY, geminiUrl } from "./gemini";

// gemini-3.5-flash-lite free tier allows 15 requests/minute per model. Pace
// every scoring call through one shared sliding window (with a small margin)
// so concurrent callers — pipeline batches, backfill, rescore scripts — can't
// collectively burst past the quota. This is the single choke point for all
// Gemini usage; extraction/chat/storylines run on OpenAI.
const MAX_REQUESTS_PER_WINDOW = 14;
const WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRateLimitSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= WINDOW_MS) {
      requestTimestamps.shift();
    }
    // No await between the check and the push, so admission is atomic and
    // concurrent callers can't over-admit.
    if (requestTimestamps.length < MAX_REQUESTS_PER_WINDOW) {
      requestTimestamps.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - requestTimestamps[0]) + 50;
    await sleep(waitMs);
  }
}

// Gemini 429 responses carry the wait time in error.details[].retryDelay
// (e.g. "48s"). Honour it when present; otherwise back off a few seconds.
function parseRetryDelayMs(body: unknown): number {
  const details = (body as { error?: { details?: Array<{ retryDelay?: string }> } })
    ?.error?.details;
  const retryDelay = details?.find((d) => d.retryDelay)?.retryDelay;
  const match = retryDelay?.match(/([\d.]+)s/);
  if (match) {
    return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 500, WINDOW_MS);
  }
  return 5000;
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
      await acquireRateLimitSlot();

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
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const body = await response.json().catch(() => null);
        const waitMs = parseRetryDelayMs(body);
        console.warn(
          `[scorer] Rate limited (429), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS - 1})`
        );
        await sleep(waitMs);
        continue;
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
