import {
  hybridSearchArticles,
  listArticlesByDate,
  getStoryOutlets,
  type ArticleRow,
} from "./db/queries";
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
  /**
   * What to search for. Omitted, the call becomes a browse: the window named by
   * `feed`/`from`/`to` is returned newest first, unranked by topic.
   */
  query?: string;
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
 *
 * `alsoReportedBy` is left empty here and filled from the story group itself
 * once the final set is known — see `attachCorroboration`.
 */
function collapseStories(rows: ArticleRow[]): RetrievedArticle[] {
  const seenStories = new Set<string>();
  const results: RetrievedArticle[] = [];

  for (const row of rows) {
    // Rows arrive already ordered — by fused rank, or by date when browsing —
    // so the first copy seen is the one worth keeping either way.
    if (row.story_group && seenStories.has(row.story_group)) continue;

    const article: RetrievedArticle = {
      slug: row.slug,
      title: row.title,
      summary: row.summary.slice(0, MAX_SUMMARY_CHARS),
      date: row.date,
      sourceDomain: row.source_domain,
      feed: row.feed,
      alsoReportedBy: [],
    };

    if (row.story_group) seenStories.add(row.story_group);
    results.push(article);
  }

  return results;
}

/**
 * Names every other outlet that carried each returned story.
 *
 * Reading this from the group rather than from the rows that ranked is the
 * difference between "one outlet reported this" and the truth: a second
 * outlet's copy frequently misses the question's wording and never enters the
 * result set, which understated corroboration on 40% of grouped stories when
 * it was inferred from ranking alone.
 *
 * Runs after the budget and slice, so it costs one query for the handful of
 * articles actually being returned.
 */
async function attachCorroboration(
  articles: RetrievedArticle[],
  rows: ArticleRow[]
): Promise<void> {
  const groupBySlug = new Map(rows.map((r) => [r.slug, r.story_group]));
  const groups = articles
    .map((a) => groupBySlug.get(a.slug))
    .filter((g): g is string => Boolean(g));
  if (groups.length === 0) return;

  const outlets = await getStoryOutlets(groups);
  for (const article of articles) {
    const group = groupBySlug.get(article.slug);
    if (!group) continue;
    article.alsoReportedBy = (outlets.get(group) ?? []).filter(
      (domain) => domain !== article.sourceDomain
    );
  }
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
 * Finds articles for a question, or lists a window when given no query.
 *
 * Returns `[]` rather than throwing when the query cannot be embedded — a
 * failed tool call should cost the model one empty result it can react to, not
 * the whole answer.
 */
export async function retrieveArticles(
  params: RetrievalParams
): Promise<RetrievedArticle[]> {
  const query = params.query?.trim();

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  // Over-fetch on both paths: collapsing same-story duplicates shrinks the
  // list, so asking for exactly `limit` rows would return fewer than requested
  // whenever the results contain a story more than one outlet covered.
  const scope = {
    feed: params.feed,
    from: params.from,
    to: params.to,
    limit: limit * 2,
  };

  let rows: ArticleRow[];
  if (query) {
    // A null vector is not fatal. The daily embedding allowance is small enough
    // to actually run out, and a reader asking a question then deserves the
    // lexical answer rather than silence.
    const embedding = await embedQueryCached(query);
    if (!embedding) {
      console.warn("[retrieval] No query vector — falling back to lexical only");
    }
    rows = await hybridSearchArticles({ query, embedding, ...scope });
  } else {
    rows = await listArticlesByDate(scope);
  }

  const results = applyBudget(collapseStories(rows)).slice(0, limit);
  await attachCorroboration(results, rows);
  return results;
}
