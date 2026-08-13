import { hybridSearchArticles, type RetrievalRow } from "./db/queries";
import { embedQuery } from "./embeddings";
import type { FeedType, RetrievedArticle } from "./types";

/**
 * Retrieval for the AI reader.
 *
 * A sibling to `searchArticles`, not a variant of it. The search page and a
 * model asking questions want opposite things: the page is a precision
 * instrument — exact hits, highlighted terms, stable paging — while a model
 * wants recall, because it can read twenty candidates and discard the poor
 * ones silently. Serving both from one ranking function would compromise each.
 *
 * The shapes differ for the same reason. Nothing here returns highlight
 * sentinels, reading times, or offsets; it returns the least text that lets a
 * model decide what to cite, under a budget, because this output is spent
 * against a context window.
 */

/** Default results per call. Enough to reason over, short enough to read. */
const DEFAULT_LIMIT = 12;

/**
 * Ceiling on what one retrieval may spend. A model can ask for more results
 * than a context window should carry, and a tool that quietly returns 40k
 * characters starves the conversation it was meant to inform.
 */
const MAX_LIMIT = 30;
const MAX_CHARS = 12_000;

/**
 * Summaries are ~200 characters on average but occasionally run long; truncate
 * so one outlier can't crowd out three other articles.
 */
const MAX_SUMMARY_CHARS = 400;

export type { RetrievedArticle };

export interface RetrievalParams {
  query: string;
  feed?: FeedType | "all";
  /** Inclusive `YYYY-MM-DD` bounds, matching `articles.date`. */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Question text to vector, memoised.
 *
 * A model re-asks the same thing across turns of one conversation, and each
 * miss is a network round trip on the critical path of an answer. Bounded
 * because this lives for the lifetime of the server process.
 */
const QUERY_VECTOR_CACHE_SIZE = 200;
const queryVectors = new Map<string, number[]>();

async function embedQueryCached(query: string): Promise<number[] | null> {
  const cached = queryVectors.get(query);
  if (cached) {
    // Refresh recency: re-inserting moves the key to the end of the Map's
    // insertion order, which is what makes the eviction below LRU and not FIFO.
    queryVectors.delete(query);
    queryVectors.set(query, cached);
    return cached;
  }

  const vector = await embedQuery(query);
  if (!vector) return null;

  if (queryVectors.size >= QUERY_VECTOR_CACHE_SIZE) {
    const oldest = queryVectors.keys().next().value;
    if (oldest !== undefined) queryVectors.delete(oldest);
  }
  queryVectors.set(query, vector);
  return vector;
}

/**
 * Collapses same-story duplicates.
 *
 * CNA and ST covering one event is not two pieces of evidence, but to a model
 * reading a flat list it looks like corroboration — and repetition inside a
 * context window reads as importance. Keeping the best-ranked copy and naming
 * the others preserves the useful part (several outlets carried this) without
 * spending four slots on it.
 */
function collapseStories(rows: RetrievalRow[]): RetrievedArticle[] {
  const byStory = new Map<string, RetrievedArticle>();
  const results: RetrievedArticle[] = [];

  for (const row of rows) {
    const article: RetrievedArticle = {
      slug: row.slug,
      title: row.title,
      summary: row.summary.slice(0, MAX_SUMMARY_CHARS),
      date: row.date,
      sourceDomain: row.source_domain,
      feed: row.feed,
      alsoReportedBy: [],
    };

    if (!row.story_group) {
      results.push(article);
      continue;
    }

    const seen = byStory.get(row.story_group);
    if (seen) {
      // Rows arrive in fused-rank order, so the first is the best-ranked copy.
      if (!seen.alsoReportedBy.includes(row.source_domain)) {
        seen.alsoReportedBy.push(row.source_domain);
      }
      continue;
    }

    byStory.set(row.story_group, article);
    results.push(article);
  }

  return results;
}

/** Trims the tail until the batch fits the character budget. */
function applyBudget(articles: RetrievedArticle[]): RetrievedArticle[] {
  const kept: RetrievedArticle[] = [];
  let chars = 0;

  for (const article of articles) {
    const cost = article.title.length + article.summary.length;
    // Always keep one, so a single oversized article yields a result rather
    // than an empty answer.
    if (kept.length > 0 && chars + cost > MAX_CHARS) break;
    kept.push(article);
    chars += cost;
  }

  return kept;
}

/**
 * Finds articles relevant to a question. Returns `[]` rather than throwing
 * when the query cannot be embedded — a failed tool call should cost the model
 * one empty result it can react to, not the whole answer.
 */
export async function retrieveArticles(
  params: RetrievalParams
): Promise<RetrievedArticle[]> {
  const query = params.query.trim();
  if (!query) return [];

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  // A null vector is not fatal. The daily embedding allowance is small enough
  // to actually run out, and a reader asking a question then deserves the
  // lexical answer rather than silence.
  const embedding = await embedQueryCached(query);
  if (!embedding) {
    console.warn("[retrieval] No query vector — falling back to lexical only");
  }

  // Over-fetch: collapsing same-story duplicates shrinks the list, so asking
  // for exactly `limit` rows would return fewer than requested whenever the
  // results contain a story more than one outlet covered.
  const rows = await hybridSearchArticles({
    query,
    embedding,
    feed: params.feed,
    from: params.from,
    to: params.to,
    limit: limit * 2,
  });

  return applyBudget(collapseStories(rows)).slice(0, limit);
}
