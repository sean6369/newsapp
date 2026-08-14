import {
  GEMINI_API_KEY,
  geminiUrl,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from "./gemini";
import {
  createRateLimiter,
  createTokenLimiter,
  estimateTokens,
  isDailyQuotaError,
  parseRetryDelayMs,
  sleep,
} from "./rate-limit";

/**
 * Thrown when the free tier's daily embedding allowance is spent. Distinct
 * from an ordinary failure because there is no point continuing: every further
 * request today fails the same way. Callers stop the run and resume tomorrow —
 * unembedded rows stay null, which is already how work is picked back up.
 */
export class DailyQuotaExceededError extends Error {
  constructor() {
    super("Gemini daily embedding quota exhausted");
    this.name = "DailyQuotaExceededError";
  }
}

/**
 * Hard cap the API puts on one `batchEmbedContents` call.
 *
 * Worth being clear about what batching does and does not buy: the free tier
 * counts each *item* against `EmbedContentRequestsPerDay` (1,000), not each
 * HTTP call, so bundling 50 articles costs the same quota as 50 separate
 * calls. Batching is a latency and throughput win only.
 */
const MAX_BATCH_ITEMS = 100;

/**
 * Share of the per-minute token budget any single batch may claim.
 *
 * Deliberately below 1.0. Batching by a fixed article count instead lets a
 * batch exceed the whole window — 50 articles is ~28k tokens against a 25k
 * budget — and then no batch can ever satisfy the limiter's fit test, so every
 * one falls through the oversized-request escape hatch and the limiter stops
 * responding to volume at all. Sizing batches from the budget keeps the fit
 * test meaningful, and makes long articles produce smaller batches by
 * themselves.
 */
const BATCH_TOKEN_FRACTION = 0.4;

const WINDOW_MS = 60_000;

/**
 * The free tier throttles embedding by token volume: 50 articles is a single
 * request but ~28k tokens, and two such calls back to back draw a 429 asking
 * for a ~34s wait. The exact ceiling isn't published per model and is visible
 * only in AI Studio, so pace against a deliberately conservative default and
 * let `GEMINI_EMBED_TPM` raise it for a paid key.
 */
const TOKENS_PER_MINUTE = Number(process.env.GEMINI_EMBED_TPM) || 25_000;

const requestLimiter = createRateLimiter(60, WINDOW_MS);
const tokenLimiter = createTokenLimiter(TOKENS_PER_MINUTE, WINDOW_MS);

/**
 * Generous because a long backfill will meet the occasional 429 no matter how
 * carefully it paces — each retry honours the delay the server asks for, so
 * extra attempts cost waiting, not quota.
 */
const MAX_ATTEMPTS = 5;

/**
 * How much of the body joins the title and summary in the embedded text.
 *
 * Title plus summary alone averages ~200 characters across the corpus — enough
 * to place an article's topic but not what it actually says, which is what a
 * question needs to match against. The lede carries the substance in news
 * copy, so this reaches into the body without embedding the whole thing:
 * averaging one vector over 4,000+ characters blurs the specifics back out.
 */
const CONTENT_CHARS = 2000;

/** Documents and questions are embedded for different ends; Gemini asks which. */
type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbeddableArticle {
  title: string;
  summary: string;
  content: string | null;
}

/**
 * The text an article is indexed by. Kept here rather than at the call sites
 * so backfill and the live pipeline can never disagree about it — two
 * different recipes in one column would degrade ranking silently.
 */
export function embeddingInput(article: EmbeddableArticle): string {
  const body = article.content?.slice(0, CONTENT_CHARS) ?? "";
  return [article.title, article.summary, body].filter(Boolean).join("\n\n");
}

interface EmbedResponse {
  embeddings?: Array<{ values: number[] }>;
  error?: { message?: string };
}

/**
 * Embeds one batch, retrying the quota rejections the free tier hands out
 * under load. Returns null rather than throwing so a single bad batch costs
 * its own rows and not the whole run — the caller leaves them null for a later
 * pass, exactly as unscored articles are handled.
 */
async function embedBatch(
  texts: string[],
  taskType: TaskType
): Promise<number[][] | null> {
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    })),
  });

  const tokens = texts.reduce((sum, t) => sum + estimateTokens(t), 0);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await requestLimiter.acquire();
      await tokenLimiter.acquire(tokens);

      const response = await fetch(
        `${geminiUrl("batchEmbedContents", EMBEDDING_MODEL)}?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }
      );

      if (response.status === 429) {
        const errorBody = await response.json().catch(() => null);
        if (isDailyQuotaError(errorBody)) throw new DailyQuotaExceededError();
        if (attempt >= MAX_ATTEMPTS) {
          console.error("[embeddings] Rate limited, attempts exhausted");
          return null;
        }
        const waitMs = parseRetryDelayMs(errorBody, 5000, WINDOW_MS);
        console.warn(
          `[embeddings] Rate limited (429), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS - 1})`
        );
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(
          `[embeddings] Gemini API error ${response.status}: ${detail.slice(0, 300)}`
        );
        return null;
      }

      const data: EmbedResponse = await response.json();
      const values = data.embeddings?.map((e) => e.values);

      // A short batch would misalign every vector after the gap when zipped
      // back against its slug, so reject the batch rather than mis-assign it.
      if (!values || values.length !== texts.length) {
        console.error(
          `[embeddings] Expected ${texts.length} embeddings, got ${values?.length ?? 0}`
        );
        return null;
      }

      if (values.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        console.error(`[embeddings] Wrong dimensionality in response`);
        return null;
      }

      return values;
    } catch (error) {
      // The daily cap is the caller's decision to act on, not a batch-level
      // failure to absorb — everything after it would fail identically.
      if (error instanceof DailyQuotaExceededError) throw error;
      console.error("[embeddings] Error embedding batch:", error);
      return null;
    }
  }

  return null;
}

/**
 * Splits texts into batches that fit the token budget, walking them in order.
 *
 * A batch always takes at least one text, so a single item larger than the
 * ceiling still goes out on its own rather than stalling the walk.
 */
function* plannedBatches(
  texts: string[]
): Generator<{ from: number; batch: string[] }> {
  const ceiling = Math.max(1, Math.floor(TOKENS_PER_MINUTE * BATCH_TOKEN_FRACTION));
  let from = 0;

  while (from < texts.length) {
    let to = from;
    let tokens = 0;

    while (to < texts.length && to - from < MAX_BATCH_ITEMS) {
      const next = estimateTokens(texts[to]);
      if (to > from && tokens + next > ceiling) break;
      tokens += next;
      to++;
    }

    yield { from, batch: texts.slice(from, to) };
    from = to;
  }
}

/**
 * Embeds documents in batches. The result is positionally aligned with
 * `texts`; entries whose batch failed come back null.
 *
 * Stops early on the daily cap rather than propagating it, so a partially
 * embedded run still stores what it managed. `quotaExhausted` lets the caller
 * say why it stopped instead of reporting a pile of ordinary failures.
 */
export async function embedDocuments(
  texts: string[]
): Promise<{ vectors: (number[] | null)[]; quotaExhausted: boolean }> {
  const vectors: (number[] | null)[] = new Array(texts.length).fill(null);

  for (const { from, batch } of plannedBatches(texts)) {
    let embedded: number[][] | null;
    try {
      embedded = await embedBatch(batch, "RETRIEVAL_DOCUMENT");
    } catch (error) {
      if (error instanceof DailyQuotaExceededError) {
        console.warn(
          `[embeddings] Daily quota reached after ${from}/${texts.length} — resuming needs a new day`
        );
        return { vectors, quotaExhausted: true };
      }
      throw error;
    }

    if (!embedded) continue; // Leave this batch's slots null for a later pass.
    embedded.forEach((vector, i) => {
      vectors[from + i] = vector;
    });
  }

  return { vectors, quotaExhausted: false };
}

/**
 * Embeds a search question. `RETRIEVAL_QUERY` rather than the document task
 * type: the model places questions and the passages that answer them in the
 * same neighbourhood only when each is embedded as what it is.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const vectors = await embedBatch([text], "RETRIEVAL_QUERY");
    return vectors?.[0] ?? null;
  } catch (error) {
    // Answering a question is interactive: a null here degrades retrieval to
    // its lexical arm, which is far better than failing the whole reply.
    if (error instanceof DailyQuotaExceededError) {
      console.warn("[embeddings] Daily quota reached — query not embedded");
      return null;
    }
    throw error;
  }
}

/**
 * Embeds a batch and stores what succeeded, reporting the counts.
 *
 * The same loop had grown in three places — the pipeline, the backfill script,
 * and the backfill route — and a fourth was about to appear for the catch-up
 * pass. Failures deliberately leave `embedding` null rather than recording
 * anything: null is the retry signal every one of those callers depends on.
 */
export async function embedAndStore(
  rows: Array<{ slug: string } & EmbeddableArticle>,
  store: (slug: string, embedding: number[]) => Promise<void>
): Promise<{ embedded: number; failed: number; quotaExhausted: boolean }> {
  if (rows.length === 0) return { embedded: 0, failed: 0, quotaExhausted: false };

  const { vectors, quotaExhausted } = await embedDocuments(rows.map(embeddingInput));

  let embedded = 0;
  let failed = 0;

  for (const [i, vector] of vectors.entries()) {
    if (!vector) {
      failed++;
      continue;
    }
    try {
      await store(rows[i].slug, vector);
      embedded++;
    } catch (error) {
      failed++;
      console.error(`[embeddings] Failed to store ${rows[i].slug}:`, error);
    }
  }

  return { embedded, failed, quotaExhausted };
}
