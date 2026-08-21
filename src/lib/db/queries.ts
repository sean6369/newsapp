import { eq, ne, gte, desc, asc, ilike, or, and, sql, isNull, inArray, type SQL } from "drizzle-orm";
import { db } from "./index";
import { articles, feedSources } from "./schema";
import { EMBEDDING_MODEL } from "../gemini";
import { LIBRARY_FEED, type Article, type ArticleFilters, type FeedType, type SearchFilters, type SearchResponse, type SearchResultArticle } from "../types";
import { groupByStory } from "../group-stories";

/**
 * "The pipeline fetched this", for drizzle's query builder.
 *
 * Origin, not membership. Every query behind the home feed, the Ask retrieval,
 * and the scoring and embedding passes carries it, because all of them are
 * about the archive the app gathers: a page the reader pasted was never in a
 * feed, has no publication day worth filing under, and should not spend the
 * Gemini quota the day's news needs.
 *
 * What it deliberately does *not* test is `articles.library`. A saved Straits
 * Times story is in the reader's library and still in Thursday's feed, still
 * scored, still groupable with the other outlets that ran it — testing the
 * flag here would drop it out of all of that the moment it was saved.
 *
 * Queries that address one row by slug (the reader, chat, the exports) carry
 * neither: there the caller already knows which article it wants.
 */
const pipelineOnly = ne(articles.feed, LIBRARY_FEED);

/** The same filter for the raw-SQL queries, appended to an existing `WHERE`. */
const PIPELINE_ONLY = sql` AND a.feed <> ${LIBRARY_FEED}`;

const articleColumns = {
  slug: articles.slug,
  title: articles.title,
  sourceUrl: articles.sourceUrl,
  sourceDomain: articles.sourceDomain,
  summary: articles.summary,
  category: articles.category,
  feed: articles.feed,
  date: articles.date,
  readingTime: articles.readingTime,
  clipped: articles.clipped,
  library: articles.library,
  savedAt: articles.savedAt,
  relevanceScore: articles.relevanceScore,
  storyGroup: articles.storyGroup,
  createdAt: articles.createdAt,
  sourceId: articles.sourceId,
  updatedAt: articles.updatedAt,
} as const;

export async function insertArticle(
  article: Article,
  content: string
): Promise<boolean> {
  const result = await db
    .insert(articles)
    .values({
      slug: article.slug,
      title: article.title,
      sourceUrl: article.sourceUrl,
      sourceDomain: article.sourceDomain,
      summary: article.summary,
      category: article.category,
      feed: article.feed,
      date: article.date,
      readingTime: article.readingTime,
      clipped: article.clipped,
      library: article.library,
      savedAt: article.savedAt ? new Date(article.savedAt) : null,
      relevanceScore: article.relevanceScore,
      sourceId: article.sourceId,
      content,
    })
    .onConflictDoNothing()
    .returning({ slug: articles.slug });
  return result.length > 0;
}

export async function getArticleBySlug(
  slug: string
): Promise<Article | null> {
  const rows = await db
    .select(articleColumns)
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  return rows[0] ? rowToArticle(rows[0]) : null;
}

export async function getArticleContent(
  slug: string
): Promise<string | null> {
  const rows = await db
    .select({ content: articles.content })
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  return rows[0]?.content ?? null;
}

export async function queryArticles(
  filters: ArticleFilters
): Promise<Article[]> {
  const conditions: (SQL | undefined)[] = [pipelineOnly];

  if (filters.feed && filters.feed !== "all") {
    conditions.push(eq(articles.feed, filters.feed));
  }
  if (filters.date) {
    conditions.push(eq(articles.date, filters.date));
  }
  const search = filters.search?.trim();
  if (search) {
    // Same matching as /search: the GIN-indexed weighted tsvector, with
    // websearch syntax ("phrases", -exclusions, or). The domain check is kept
    // as a fallback so filtering by source ("straitstimes") still works —
    // sourceDomain isn't part of search_vector.
    conditions.push(
      or(
        sql`${articles.searchVector} @@ websearch_to_tsquery('english', ${search})`,
        ilike(articles.sourceDomain, `%${search.replace(/[\\%_]/g, "\\$&")}%`)
      )
    );
  }

  const orderBy =
    filters.sort === "relevance"
      ? [sql`${articles.relevanceScore} DESC NULLS LAST`, desc(articles.createdAt)]
      : filters.sort === "date-asc"
        ? [asc(articles.createdAt)]
        : [desc(articles.createdAt)];

  const rows = await db
    .select(articleColumns)
    .from(articles)
    .where(and(...conditions))
    .orderBy(...orderBy);

  return rows.map((r) => rowToArticle(r));
}

export async function getLastFetchTime(): Promise<string | null> {
  const rows = await db
    .select({ createdAt: articles.createdAt })
    .from(articles)
    .where(pipelineOnly)
    .orderBy(desc(articles.createdAt))
    .limit(1);
  return rows[0]?.createdAt?.toISOString() ?? null;
}

/**
 * Every day the archive holds an article for, newest first.
 *
 * Clips are excluded by default because the caller that matters most is the
 * feed's date navigator, and a clip saved today would put a day on it that
 * holds no news. Search asks for them: its calendar bounds the days you can
 * filter to, so leaving clips out would make the library scope unfilterable
 * on exactly the dates it has articles.
 */
export async function getArticleDates(
  options?: { includeLibrary?: boolean }
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: articles.date })
    .from(articles)
    .where(options?.includeLibrary ? undefined : pipelineOnly)
    .orderBy(desc(articles.date));
  return rows.map((r) => r.date);
}

type ArticleForScoring = { slug: string; title: string; summary: string; category: string; feed: string };

const scoringColumns = {
  slug: articles.slug,
  title: articles.title,
  summary: articles.summary,
  category: articles.category,
  feed: articles.feed,
};

export async function getUnscoredArticles(): Promise<ArticleForScoring[]> {
  return db
    .select(scoringColumns)
    .from(articles)
    .where(and(isNull(articles.relevanceScore), pipelineOnly));
}

/**
 * Recent articles still missing a relevance score, newest first.
 *
 * The scoring counterpart to {@link getRecentUnembeddedArticles}, and it exists
 * for the same reason: the pipeline only scores rows a run just inserted, so an
 * article whose scoring call failed keeps a null score indefinitely.
 * {@link getUnscoredArticles} can repair one, but only `/api/backfill` calls it
 * and nothing calls that — which is how a backlog of null scores built up.
 *
 * Bounded rather than unbounded because scoring is the tighter Gemini quota:
 * this runs hourly, so the limit is a per-run spend, not a one-off cost.
 */
export async function getRecentUnscoredArticles(
  sinceDate: string,
  limit: number
): Promise<ArticleForScoring[]> {
  return db
    .select(scoringColumns)
    .from(articles)
    .where(and(isNull(articles.relevanceScore), gte(articles.date, sinceDate), pipelineOnly))
    .orderBy(desc(articles.date))
    .limit(limit);
}

export async function getAllArticlesForScoring(): Promise<ArticleForScoring[]> {
  return db.select(scoringColumns).from(articles).where(pipelineOnly);
}

export async function updateRelevanceScore(
  slug: string,
  score: number | null
): Promise<void> {
  await db
    .update(articles)
    .set({ relevanceScore: score })
    .where(eq(articles.slug, slug));
}

const embeddingColumns = {
  slug: articles.slug,
  title: articles.title,
  summary: articles.summary,
  content: articles.content,
};

export type ArticleForEmbedding = {
  slug: string;
  title: string;
  summary: string;
  content: string | null;
};

/**
 * Rows still awaiting a vector, either never embedded or embedded by a model
 * we no longer use. Vectors from different models occupy different spaces, so
 * a mixed column ranks badly rather than erroring — catching the mismatch here
 * is what makes a model change recoverable by re-running the backfill.
 */
export async function getUnembeddedArticles(): Promise<ArticleForEmbedding[]> {
  return db
    .select(embeddingColumns)
    .from(articles)
    .where(
      and(
        or(isNull(articles.embedding), ne(articles.embeddingModel, EMBEDDING_MODEL)),
        pipelineOnly
      )
    )
    // Newest first, so a backfill interrupted partway through has still
    // covered the articles most likely to be asked about.
    .orderBy(desc(articles.date));
}

/**
 * Every article, staleest embedding first. The ordering is what makes a forced
 * re-embed resumable: storing a vector stamps `embedded_at`, moving that row to
 * the back, so repeated capped calls walk the corpus instead of re-embedding
 * the same head of it.
 */
/**
 * Recent articles still missing a vector, newest first.
 *
 * The horizon is the point. Nothing else retries a failed embedding — the
 * pipeline only embeds the rows a run just inserted — so a call that fails on
 * quota or a rate limit leaves a hole that would otherwise never be filled.
 * Bounding the lookback repairs the window semantic search is meant to cover
 * without ever reaching back into history the reader has chosen to leave
 * lexical-only.
 */
export async function getRecentUnembeddedArticles(
  sinceDate: string,
  limit: number
): Promise<ArticleForEmbedding[]> {
  return db
    .select(embeddingColumns)
    .from(articles)
    .where(
      and(
        or(isNull(articles.embedding), ne(articles.embeddingModel, EMBEDDING_MODEL)),
        gte(articles.date, sinceDate),
        pipelineOnly
      )
    )
    .orderBy(desc(articles.date))
    .limit(limit);
}

export async function getAllArticlesForEmbedding(): Promise<ArticleForEmbedding[]> {
  return db
    .select(embeddingColumns)
    .from(articles)
    .where(pipelineOnly)
    .orderBy(sql`${articles.embeddedAt} ASC NULLS FIRST`);
}

/**
 * Read back for embedding rather than reusing the in-memory `RawArticle`: the
 * stored row is what a backfill would later see, so both paths embed byte-identical text.
 */
export async function getArticlesForEmbeddingBySlugs(
  slugs: string[]
): Promise<ArticleForEmbedding[]> {
  if (slugs.length === 0) return [];
  return db.select(embeddingColumns).from(articles).where(inArray(articles.slug, slugs));
}

export async function updateArticleEmbedding(
  slug: string,
  embedding: number[]
): Promise<void> {
  await db
    .update(articles)
    .set({ embedding, embeddingModel: EMBEDDING_MODEL, embeddedAt: new Date() })
    .where(eq(articles.slug, slug));
}

/**
 * `date` is carried so a title change can tell `matchStories` which day to
 * re-examine — the stored date, not the incoming one, since that is the day
 * this article is matched within.
 */
type ExistingArticleRow = { slug: string; title: string; sourceUrl: string; date: string };

export async function getExistingArticles(
  sourceIds: string[],
  sourceUrls: string[]
): Promise<{
  bySourceId: Map<string, ExistingArticleRow>;
  bySourceUrl: Map<string, ExistingArticleRow>;
}> {
  const cols = { slug: articles.slug, title: articles.title, sourceUrl: articles.sourceUrl, sourceId: articles.sourceId, date: articles.date };
  const bySourceId = new Map<string, ExistingArticleRow>();
  const bySourceUrl = new Map<string, ExistingArticleRow>();

  if (sourceIds.length === 0) return { bySourceId, bySourceUrl };

  // Primary: batch lookup by sourceId
  const byId = await db
    .select(cols)
    .from(articles)
    .where(and(inArray(articles.sourceId, sourceIds), pipelineOnly));
  const matchedSourceIds = new Set<string>();
  for (const r of byId) {
    if (!r.sourceId) continue;
    bySourceId.set(r.sourceId, r);
    matchedSourceIds.add(r.sourceId);
  }

  // Fallback: batch lookup by sourceUrl for unmatched articles (pre-backfill rows)
  const unmatchedUrls = sourceUrls.filter((_, i) => !matchedSourceIds.has(sourceIds[i]));
  if (unmatchedUrls.length > 0) {
    const byUrl = await db
      .select(cols)
      .from(articles)
      .where(and(inArray(articles.sourceUrl, unmatchedUrls), pipelineOnly));
    for (const r of byUrl) {
      bySourceUrl.set(r.sourceUrl, r);
    }
  }

  return { bySourceId, bySourceUrl };
}

export async function updateArticleMetadata(
  slug: string,
  updates: {
    title?: string;
    sourceUrl?: string;
    summary?: string;
    content?: string;
  }
): Promise<void> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.title !== undefined) setClause.title = updates.title;
  if (updates.sourceUrl !== undefined) setClause.sourceUrl = updates.sourceUrl;
  if (updates.summary !== undefined) setClause.summary = updates.summary;
  if (updates.content !== undefined) {
    setClause.content = updates.content;
  }

  await db
    .update(articles)
    .set(setClause)
    .where(eq(articles.slug, slug));
}

function rowToArticle(row: {
  slug: string;
  title: string;
  sourceUrl: string;
  sourceDomain: string;
  summary: string;
  category: string;
  feed: string;
  date: string;
  readingTime: number;
  clipped: boolean;
  library: boolean;
  savedAt: Date | null;
  relevanceScore: number | null;
  storyGroup: string | null;
  createdAt: Date;
  sourceId: string | null;
  updatedAt: Date | null;
}): Article {
  return {
    slug: row.slug,
    title: row.title,
    sourceUrl: row.sourceUrl,
    sourceDomain: row.sourceDomain,
    summary: row.summary,
    category: row.category,
    feed: row.feed as FeedType,
    date: row.date,
    readingTime: row.readingTime,
    clipped: row.clipped,
    library: row.library,
    savedAt: row.savedAt?.toISOString() ?? null,
    relevanceScore: row.relevanceScore,
    storyGroup: row.storyGroup,
    createdAt: row.createdAt.toISOString(),
    sourceId: row.sourceId ?? "",
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

// ── Full-text search ──────────────────────────────────────────────────

/**
 * Raw markdown is stored in `articles.content`, so strip link syntax and
 * inline markers before ts_headline sees it — otherwise snippets come back
 * full of `[text](url)`. Also collapses whitespace so fragments stay on one line.
 */
const MD_LINK_RE = "!?\\[([^\\]]*)\\]\\([^)]*\\)";
const MD_MARKS_RE = "[#*_>`]";

const snippetSource = sql`
  regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(a.content, a.summary), ${MD_LINK_RE}, '\\1', 'g'),
      ${MD_MARKS_RE}, '', 'g'
    ),
    '\\s+', ' ', 'g'
  )
`;

const HEADLINE_OPTIONS =
  'StartSel=[[HL]], StopSel=[[/HL]], MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "';

/** `HighlightAll` returns the whole title with matches marked, rather than an excerpt. */
const TITLE_HEADLINE_OPTIONS =
  "StartSel=[[HL]], StopSel=[[/HL]], HighlightAll=true";

const searchColumns = sql`
  a.slug, a.title, a.source_url, a.source_domain, a.summary, a.category,
  a.feed, a.date, a.reading_time, a.clipped, a.library, a.saved_at, a.relevance_score,
  a.story_group, a.created_at, a.source_id, a.updated_at
`;

type SearchRow = {
  slug: string;
  title: string;
  source_url: string;
  source_domain: string;
  summary: string;
  category: string;
  feed: string;
  date: string;
  reading_time: number;
  clipped: boolean;
  library: boolean;
  saved_at: string | null;
  relevance_score: number | null;
  story_group: string | null;
  created_at: string;
  source_id: string | null;
  updated_at: string | null;
  rank: number;
  snippet: string | null;
  title_snippet: string | null;
  full_count: number;
};

/**
 * `db.execute` returns raw SQL timestamps as naive strings ("2026-06-30
 * 17:37:36.8") rather than the Date objects drizzle's typed selects produce.
 * Swapping the space for a "T" yields an offset-less ISO string, which JS
 * parses as local time — matching how postgres-js decodes these columns
 * elsewhere, so both code paths agree on the instant.
 */
function parseNaiveTimestamp(value: string): Date {
  return new Date(value.replace(" ", "T"));
}

function searchRowToArticle(r: SearchRow): SearchResultArticle {
  return {
    ...rowToArticle({
      slug: r.slug,
      title: r.title,
      sourceUrl: r.source_url,
      sourceDomain: r.source_domain,
      summary: r.summary,
      category: r.category,
      feed: r.feed,
      date: r.date,
      readingTime: r.reading_time,
      clipped: r.clipped,
      library: r.library,
      savedAt: r.saved_at ? parseNaiveTimestamp(r.saved_at) : null,
      relevanceScore: r.relevance_score,
      storyGroup: r.story_group,
      createdAt: parseNaiveTimestamp(r.created_at),
      sourceId: r.source_id,
      updatedAt: r.updated_at ? parseNaiveTimestamp(r.updated_at) : null,
    }),
    rank: r.rank,
    snippet: r.snippet,
    titleHighlight: r.title_snippet,
  };
}

/**
 * Fills in copies of a story that ranked below the page boundary.
 *
 * `groupByStory` can only collapse what the page contains, so a card's source
 * switcher ends up holding whichever copies happened to rank inside the LIMIT
 * — measurably understating a story on the first page, since the remaining
 * copies usually match the query perfectly well and simply sorted lower. One
 * batched lookup completes each group so the switcher reflects the story
 * rather than the pagination.
 *
 * Scoped by the caller's filters, unlike the Ask path's `getStoryOutlets`:
 * these are whole articles the reader can open, so a feed or date filter has
 * to hold. Naming an out-of-scope outlet is informational; surfacing an
 * out-of-scope article is not.
 */
async function completeStoryGroups(
  results: (SearchResultArticle & { relatedArticles?: SearchResultArticle[] })[],
  scopeFilter: SQL,
  /** Null on the fuzzy path, where there is no tsquery to highlight with. */
  query: string | null
): Promise<void> {
  const byGroup = new Map<string, SearchResultArticle & { relatedArticles?: SearchResultArticle[] }>();
  const shown = new Set<string>();
  for (const a of results) {
    shown.add(a.slug);
    for (const rel of a.relatedArticles ?? []) shown.add(rel.slug);
    if (a.storyGroup && !byGroup.has(a.storyGroup)) byGroup.set(a.storyGroup, a);
  }
  if (byGroup.size === 0) return;

  const groupList = sql.join([...byGroup.keys()].map((g) => sql`${g}`), sql`, `);
  const shownList = sql.join([...shown].map((s) => sql`${s}`), sql`, `);

  // Highlighting the extra copies keeps them consistent with the rows that came
  // through the ranked query; on the fuzzy path there is no query to highlight.
  const ranked = query
    ? sql`
        WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq)
        SELECT ${searchColumns},
          COALESCE(ts_rank_cd(a.search_vector, q.tsq), 0)::real AS rank,
          ts_headline('english', ${snippetSource}, q.tsq, ${HEADLINE_OPTIONS}) AS snippet,
          ts_headline('english', a.title, q.tsq, ${TITLE_HEADLINE_OPTIONS}) AS title_snippet,
          0::int AS full_count
        FROM articles a CROSS JOIN q`
    : sql`
        SELECT ${searchColumns}, 0::real AS rank,
          NULL::text AS snippet, NULL::text AS title_snippet, 0::int AS full_count
        FROM articles a`;

  const rows = (await db.execute(sql`
    ${ranked}
    WHERE a.story_group IN (${groupList})
      AND a.slug NOT IN (${shownList})${scopeFilter}
    ORDER BY a.story_group, a.created_at DESC
  `)) as unknown as SearchRow[];

  for (const row of rows) {
    const primary = row.story_group ? byGroup.get(row.story_group) : undefined;
    if (!primary) continue;
    primary.relatedArticles = [...(primary.relatedArticles ?? []), searchRowToArticle(row)];
  }
}

/**
 * Search every article, all dates, via the weighted `search_vector` GIN index.
 *
 * Accepts websearch syntax — `"quoted phrases"`, `-exclusions`, `or` — and
 * ranks with ts_rank_cd so title hits beat body hits. When full-text finds
 * nothing (typo, or a name the stemmer mangles) it retries with trigram word
 * similarity against titles and reports `mode: "fuzzy"` so the UI can say so.
 */
export async function searchArticles(
  filters: SearchFilters
): Promise<SearchResponse> {
  const { query, feed, from, to, sort = "relevance", limit = 40, offset = 0 } = filters;

  const trimmed = query.trim();
  if (!trimmed) return { results: [], total: 0, rowCount: 0, mode: "empty" };

  const fromFilter = from ? sql` AND a.date >= ${from}` : sql``;
  const toFilter = to ? sql` AND a.date <= ${to}` : sql``;

  // `library` is a scope, not a feed. It reads `articles.library` —
  // membership, not the origin `pipelineOnly` tests — because a saved Straits
  // Times story is in the library every bit as much as a pasted page, and
  // scoping by origin would hide exactly the articles this scope exists to
  // find.
  //
  // Nothing is excluded on the other paths. "All" means all, pasted pages
  // included: this is the one page where a reader is looking for an article
  // rather than reading the day's news, and a page they saved is as valid an
  // answer as a fetched one. A named feed (`tech`, `world`) still leaves
  // pasted pages out on its own, since none of them carries that feed.
  //
  // Search is alone in this. The home feed and the Ask retrieval exclude them
  // unconditionally via `pipelineOnly` and `retrievalScope` — that is where the
  // separation lives, and nothing here touches it.
  const searchingLibrary = feed === LIBRARY_FEED;
  const feedFilter =
    feed && feed !== "all" && !searchingLibrary ? sql` AND a.feed = ${feed}` : sql``;
  const libraryFilter = searchingLibrary ? sql` AND a.library = true` : sql``;

  // Every arm below inherits this: the ranked query, the no-results probe, the
  // fuzzy fallback, and `completeStoryGroups`.
  const scopeFilter = sql`${libraryFilter}${feedFilter}${fromFilter}${toFilter}`;

  // `source_domain` is not part of `search_vector`, so searching by outlet
  // ("straitstimes", "channelnewsasia") matches nothing on the vector alone.
  // The feed's own box has carried this fallback since it was written; this
  // page went without, which left the more capable search the only one that
  // could not filter by source.
  //
  // `idx_articles_domain_trgm` is what makes the leading wildcard affordable:
  // for a selective outlet the planner resolves the OR as a BitmapOr across it
  // and the tsvector index. For one that carries most of the archive it drops
  // to a sequential scan instead, which is correct rather than a regression —
  // reading 60% of the table through an index is the slower way to do it.
  //
  // A domain-only hit scores 0 from `ts_rank_cd`, so these sort below genuine
  // text matches and fall back to date order among themselves — which is the
  // right shape for "show me everything from this outlet".
  const domainMatch = sql`a.source_domain ILIKE ${`%${trimmed.replace(/[\%_]/g, "\$&")}%`}`;

  const orderBy =
    sort === "date-asc"
      ? sql`ORDER BY a.date ASC, a.created_at ASC`
      : sort === "date-desc"
        ? sql`ORDER BY a.date DESC, a.created_at DESC`
        : sql`ORDER BY rank DESC, a.date DESC, a.created_at DESC`;

  const ftsRows = (await db.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${trimmed}) AS tsq)
    SELECT ${searchColumns},
      ts_rank_cd(a.search_vector, q.tsq)::real AS rank,
      ts_headline('english', ${snippetSource}, q.tsq, ${HEADLINE_OPTIONS}) AS snippet,
      ts_headline('english', a.title, q.tsq, ${TITLE_HEADLINE_OPTIONS}) AS title_snippet,
      COUNT(*) OVER ()::int AS full_count
    FROM articles a CROSS JOIN q
    WHERE (a.search_vector @@ q.tsq OR ${domainMatch})${scopeFilter}
    ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as SearchRow[];

  if (ftsRows.length > 0) {
    const results = groupByStory(ftsRows.map(searchRowToArticle));
    await completeStoryGroups(results, scopeFilter, trimmed);
    return {
      results,
      total: Number(ftsRows[0].full_count),
      rowCount: ftsRows.length,
      mode: "fts",
    };
  }

  // Zero full-text rows has two very different causes, and only one of them
  // means "try harder". Probe before falling back — this runs only on the
  // no-results path, so the common case pays nothing.
  const probe = (await db.execute(sql`
    SELECT
      numnode(websearch_to_tsquery('english', ${trimmed}))::int AS nodes,
      EXISTS (
        SELECT 1 FROM articles a
        WHERE (a.search_vector @@ websearch_to_tsquery('english', ${trimmed})
               OR ${domainMatch})${scopeFilter}
      ) AS has_match
  `)) as unknown as Array<{ nodes: number; has_match: boolean }>;

  const empty: SearchResponse = { results: [], total: 0, rowCount: 0, mode: "empty" };

  // The query reduced to nothing searchable — only stop words or punctuation
  // ("the and of", "or", "-"). Fuzzy-matching that against titles returns pure
  // noise, so treat it as no query rather than a failed one.
  if ((probe[0]?.nodes ?? 0) === 0) return empty;

  // Running off the end of the full-text results is not the same as the search
  // finding nothing; falling back here would let "load more" append fuzzy
  // matches to a query that has exact ones.
  if (offset > 0 && probe[0]?.has_match) return empty;

  // Nothing matched — fall back to typo-tolerant title matching. `<%` is word
  // similarity (query vs. best-matching word run in the title), not whole-string
  // similarity, so a short query still matches a long headline.
  const fuzzyRows = (await db.execute(sql`
    SELECT ${searchColumns},
      word_similarity(${trimmed}, a.title)::real AS rank,
      NULL::text AS snippet,
      NULL::text AS title_snippet,
      COUNT(*) OVER ()::int AS full_count
    FROM articles a
    WHERE ${trimmed} <% a.title${scopeFilter}
    ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as SearchRow[];

  if (fuzzyRows.length === 0) return { results: [], total: 0, rowCount: 0, mode: "empty" };

  const fuzzyResults = groupByStory(fuzzyRows.map(searchRowToArticle));
  await completeStoryGroups(fuzzyResults, scopeFilter, null);
  return {
    results: fuzzyResults,
    total: Number(fuzzyRows[0].full_count),
    rowCount: fuzzyRows.length,
    mode: "fuzzy",
  };
}

/**
 * Groups articles that cover the same story, scoped to the given `YYYY-MM-DD`
 * dates — the days this run actually touched.
 *
 * Scoping by affected date rather than a rolling window is what keeps this
 * affordable. Matching only ever pairs articles *within* one day, so a group
 * can only change on a day that gained an article or had one's title rewritten;
 * every other day is provably settled and re-examining it is pure waste. That
 * waste was the dominant cost: `story_group IS NULL` reads like a small
 * work-list but is the permanent state of every article that is simply unique
 * (~87% of the table), so a rolling window re-compared thousands of settled
 * singletons on every run — ~500ms of it, hourly and on every feed mount, to
 * accomplish nothing. With no affected dates this now does no work at all.
 *
 * Callers must pass the *stored* date of anything they changed, which for a
 * retitled article is not necessarily the date being fetched.
 */
export async function matchStories(dates: string[]): Promise<number> {
  const targetDates = [...new Set(dates)];
  if (targetDates.length === 0) return 0;

  // Parameterised one-per-date rather than interpolated, so a date string can
  // never reach the query as SQL.
  const dateList = sql.join(
    targetDates.map((d) => sql`${d}`),
    sql`, `
  );

  let totalMatched = 0;

  // Run matching in passes until no new articles are grouped.
  // Each pass: for every ungrouped article, find its best match (preferring
  // articles already in a group) and assign it.  Multiple passes handle
  // transitive matches (A↔B, B↔C → all in one group).
  while (true) {
    const result = await db.execute(sql`
      WITH best_match AS (
        SELECT DISTINCT ON (a.slug)
          a.slug AS ungrouped_slug,
          -- Join the match's group if it has one, otherwise mint a key from the
          -- pair. Which of the two slugs becomes the key carries no meaning: it
          -- is an opaque identity for the group, never read as a ranking. Who
          -- represents a story on screen is decided downstream by sort position
          -- (groupByStory) or fused rank (collapseStories), so LEAST is chosen
          -- purely because it is deterministic.
          COALESCE(b.story_group, LEAST(a.slug, b.slug)) AS target_group
        FROM articles a
        JOIN articles b ON a.slug <> b.slug
          AND a.date = b.date
          AND similarity(a.title, b.title) >
            CASE WHEN a.source_domain = b.source_domain THEN 0.7 ELSE 0.5 END
        WHERE a.story_group IS NULL
          -- A pasted page has no story to belong to: it is not coverage, and
          -- grouping it with the news would surface it in the feed through the
          -- matched article's source switcher. Origin, not membership — a
          -- saved feed article is still ordinary coverage and still groups.
          AND a.feed <> 'library'
          AND b.feed <> 'library'
          AND a.date IN (${dateList})
          -- Implied by a.date = b.date, but stating it lets the planner bound
          -- both sides with idx_articles_date instead of scanning all of b.
          AND b.date IN (${dateList})
        ORDER BY a.slug,
          b.story_group IS NOT NULL DESC,
          similarity(a.title, b.title) DESC
      )
      UPDATE articles
      SET story_group = best_match.target_group
      FROM best_match
      WHERE articles.slug = best_match.ungrouped_slug
    `);

    const count = Number(result.count ?? 0);
    totalMatched += count;

    // Normalize: if an article's story_group points to a slug whose own
    // story_group differs, follow the reference so every member shares
    // the same canonical group value.
    if (count > 0) {
      await db.execute(sql`
        UPDATE articles a
        SET story_group = parent.story_group
        FROM articles parent
        WHERE a.story_group = parent.slug
          AND parent.story_group IS NOT NULL
          AND a.story_group <> parent.story_group
          -- Safe to scope like the other two statements: keys only ever come
          -- from same-day pairs, so a group never spans dates and the parent
          -- row is always on the same day as the row being normalised.
          AND a.date IN (${dateList})
      `);
    }

    // Merge separate groups that share cross-group similarity.
    // This handles the case where same-domain pairs form independent
    // groups in a single pass (e.g. 2 CNA + 2 ST articles about the
    // same story each pair within their outlet first).
    const mergeResult = await db.execute(sql`
      WITH merge_pairs AS (
        SELECT DISTINCT ON (GREATEST(a.story_group, b.story_group))
          LEAST(a.story_group, b.story_group) AS keep_group,
          GREATEST(a.story_group, b.story_group) AS merge_group
        FROM articles a
        JOIN articles b ON a.story_group <> b.story_group
          AND a.date = b.date
          AND similarity(a.title, b.title) >
            CASE WHEN a.source_domain = b.source_domain THEN 0.7 ELSE 0.5 END
        WHERE a.story_group IS NOT NULL
          AND b.story_group IS NOT NULL
          AND a.date IN (${dateList})
          AND b.date IN (${dateList})
        ORDER BY GREATEST(a.story_group, b.story_group)
      )
      UPDATE articles
      SET story_group = merge_pairs.keep_group
      FROM merge_pairs
      WHERE articles.story_group = merge_pairs.merge_group
    `);
    const mergeCount = Number(mergeResult.count ?? 0);

    if (count === 0 && mergeCount === 0) break;
  }

  if (totalMatched > 0) {
    console.log(`[stories] Matched ${totalMatched} article(s) into story groups`);
  }
  return totalMatched;
}

export async function deleteArticle(slug: string): Promise<void> {
  await db.delete(articles).where(eq(articles.slug, slug));
}

// ── Library ───────────────────────────────────────────────────────────

/**
 * Everything in the reader's library, most recently saved first.
 *
 * Both kinds: pages pasted on `/library` and feed articles the reader kept,
 * which is why it tests `library` rather than the origin `pipelineOnly` reads.
 *
 * Unfiltered and unpaginated, unlike the feed — the library is what one person
 * chose to keep, so it is small by construction and showing all of it is the
 * point. `idx_articles_library` is a partial index on `saved_at`, so this reads
 * in display order without a sort.
 */
export async function getLibraryArticles(
  options?: { search?: string }
): Promise<Article[]> {
  const conditions: (SQL | undefined)[] = [eq(articles.library, true)];

  const search = options?.search?.trim();
  if (search) {
    // The same matching the feed's own search box uses, for the same reason:
    // `search_vector` is a generated column, so a clip has been indexed over
    // its full body since the moment it was stored, and a title-only filter
    // would ignore the part of it worth searching. The domain check is the
    // same fallback too — `source_domain` is not in the vector, so without it
    // you could not find a clip by where it came from.
    conditions.push(
      or(
        sql`${articles.searchVector} @@ websearch_to_tsquery('english', ${search})`,
        ilike(articles.sourceDomain, `%${search.replace(/[\\%_]/g, "\\$&")}%`)
      )
    );
  }

  const rows = await db
    .select(articleColumns)
    .from(articles)
    .where(and(...conditions))
    // By when it was saved, not when it was created: for a saved feed article
    // `created_at` is when the pipeline ingested the story, which would file
    // last week's news a week down a library it entered this morning.
    .orderBy(desc(articles.savedAt));
  return rows.map((r) => rowToArticle(r));
}

/**
 * Adds an article the pipeline already fetched to the reader's library.
 *
 * Only sets the flag — the row keeps its feed, its score, its story group and
 * its place in the archive. Being kept by the reader says nothing about
 * whether it is also Thursday's news.
 */
export async function addToLibrary(slug: string): Promise<void> {
  await db
    .update(articles)
    .set({ library: true, savedAt: new Date() })
    .where(eq(articles.slug, slug));
}

/**
 * Takes an article out of the library.
 *
 * Unsaving, not deleting — the caller decides which it wants. A pasted page
 * exists only because it was saved, so removing it from the library should
 * delete it; a feed article outlives its stay here and must survive.
 */
export async function removeFromLibrary(slug: string): Promise<void> {
  await db
    .update(articles)
    .set({ library: false, savedAt: null })
    .where(eq(articles.slug, slug));
}

/**
 * The article stored under a URL, pasted or fetched, if there is one.
 *
 * `source_url` is uniquely indexed, so the same URL cannot be stored twice.
 * This is how the clip route learns that *before* fetching the page, and can
 * save the row it already has instead of failing on a constraint.
 */
export async function getArticleBySourceUrl(
  sourceUrl: string
): Promise<Article | null> {
  const rows = await db
    .select(articleColumns)
    .from(articles)
    .where(eq(articles.sourceUrl, sourceUrl))
    .limit(1);
  return rows[0] ? rowToArticle(rows[0]) : null;
}

/**
 * Every outlet that carried each of the given stories.
 *
 * Retrieval can only observe the copies that ranked, which is a poor proxy for
 * who covered a story: a second outlet's article often fails to match the
 * question's wording and drops out, leaving the model told that one outlet
 * reported something two did. Corroboration is exactly the signal it should
 * not have to infer from ranking, so it is read from the group directly.
 *
 * Deliberately unscoped by feed or date: this returns outlet names, not
 * articles, and "who else ran this" is true regardless of what the caller
 * filtered to.
 */
export async function getStoryOutlets(
  storyGroups: string[]
): Promise<Map<string, string[]>> {
  const groups = [...new Set(storyGroups)];
  if (groups.length === 0) return new Map();

  const rows = (await db.execute(sql`
    SELECT story_group, array_agg(DISTINCT source_domain) AS domains
    FROM articles
    WHERE story_group IN (${sql.join(groups.map((g) => sql`${g}`), sql`, `)})
    GROUP BY story_group
  `)) as unknown as { story_group: string; domains: string[] }[];

  return new Map(rows.map((r) => [r.story_group, r.domains]));
}

// ── Hybrid retrieval (semantic + lexical) ─────────────────────────────

/**
 * Candidates drawn from each arm before fusion. Generous relative to the
 * handful finally returned: fusion can only reward an article both arms found,
 * so a pool too small to overlap collapses RRF back into two separate lists.
 */
const RETRIEVAL_POOL = 60;

/**
 * The `k` in `1/(k + rank)`. 60 is the value from the original RRF paper and
 * is deliberately large relative to the pool: it flattens the curve so the
 * exact ordering *within* an arm matters less than whether both arms surfaced
 * the article at all, which is the property that makes fusion robust without
 * per-arm score normalisation.
 */
const RRF_K = 60;

/**
 * How close a vector must be to count as a match at all.
 *
 * Without this the semantic arm never returns nothing — something is always
 * nearest in vector space — so an off-topic question came back with twelve
 * unrelated articles rather than an empty result. That matters beyond tidiness:
 * the system prompt tells the model to say plainly when the archive has nothing
 * on a topic, and it could never observe that case, because "no coverage" and
 * "twelve weak matches" looked identical.
 *
 * 0.55 is where the two populations separate, measured rather than guessed.
 * Real questions about the corpus peak at 0.69–0.75 and keep all 60 candidates
 * at this floor; questions with no possible answer here ("sourdough starter
 * hydration", "fix a leaking tap") peak at 0.54 and lose all 60. Raising it to
 * 0.60 starts cutting genuine matches; lowering it to 0.50 lets two-thirds of
 * the noise back through.
 *
 * The lexical arm needs no equivalent — no keyword match already means no rows.
 */
const MIN_SIMILARITY = 0.55;

/** The columns retrieval actually reads, however the rows were found. */
export type ArticleRow = {
  slug: string;
  title: string;
  summary: string;
  date: string;
  source_domain: string;
  feed: string;
  story_group: string | null;
};

/** An `ArticleRow` plus the fusion diagnostics `scripts/check-retrieval.ts` reads. */
export type RetrievalRow = ArticleRow & {
  score: number;
  lex_rank: number | null;
  vec_rank: number | null;
};

/**
 * The feed and date narrowing both retrieval paths share.
 *
 * Written as a fragment appended to an existing `WHERE`, so every caller has to
 * supply its own leading condition — `WHERE true` where there is nothing else.
 */
function retrievalScope(params: {
  feed?: FeedType | "all";
  from?: string;
  to?: string;
}) {
  const { feed, from, to } = params;
  const feedFilter = feed && feed !== "all" ? sql` AND a.feed = ${feed}` : sql``;
  const fromFilter = from ? sql` AND a.date >= ${from}` : sql``;
  const toFilter = to ? sql` AND a.date <= ${to}` : sql``;
  return sql`${PIPELINE_ONLY}${feedFilter}${fromFilter}${toFilter}`;
}

/**
 * Retrieves articles by fusing full-text and vector search with Reciprocal
 * Rank Fusion.
 *
 * The two arms fail in opposite directions, which is the reason for running
 * both. Lexical search is precise on the proper nouns news is dense with
 * ("Nvidia", "H20") but blind to paraphrase; vector search reads through
 * "semiconductor curbs" to "chip export restrictions" but smears exact names.
 * RRF combines them on rank rather than score, so there are no incomparable
 * scales to normalise and no weights to tune.
 *
 * Unlike `searchArticles`, an unparseable or stop-word-only query is not fatal
 * here — the lexical arm simply contributes nothing and the semantic arm still
 * answers, which matters when the caller is a model writing its own queries.
 */
export async function hybridSearchArticles(params: {
  query: string;
  /** Null degrades this to lexical-only; see the `vecArm` note below. */
  embedding: number[] | null;
  feed?: FeedType | "all";
  from?: string;
  to?: string;
  limit: number;
}): Promise<RetrievalRow[]> {
  const { query, embedding, feed, from, to, limit } = params;

  const scopeFilter = retrievalScope({ feed, from, to });

  // The semantic arm, or an empty stand-in shaped like it.
  //
  // Embedding a question is a network call against a daily-capped free tier,
  // so "no vector today" is a state this has to survive. An arm that yields no
  // rows leaves RRF summing a single term, which degrades the ranking to plain
  // full-text rather than failing the retrieval. `WHERE false` keeps the
  // column types identical so the FULL OUTER JOIN below still type-checks.
  const vecArm = embedding
    ? sql`
        SELECT slug, ROW_NUMBER() OVER (ORDER BY d ASC, date DESC) AS rank
        FROM (
          SELECT a.slug, a.embedding <=> ${sql`${JSON.stringify(embedding)}::vector`} AS d, a.date
          FROM articles a
          WHERE a.embedding IS NOT NULL
            -- pgvector's <=> is cosine *distance*, so the floor inverts.
            AND a.embedding <=> ${sql`${JSON.stringify(embedding)}::vector`} < ${1 - MIN_SIMILARITY}
            ${scopeFilter}
          ORDER BY d ASC
          LIMIT ${RETRIEVAL_POOL}
        ) t`
    : sql`SELECT a.slug, ROW_NUMBER() OVER () AS rank FROM articles a WHERE false`;

  return (await db.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq),
    lex AS (
      SELECT slug, ROW_NUMBER() OVER (ORDER BY r DESC, date DESC) AS rank
      FROM (
        SELECT a.slug, ts_rank_cd(a.search_vector, q.tsq) AS r, a.date
        FROM articles a CROSS JOIN q
        WHERE a.search_vector @@ q.tsq${scopeFilter}
        ORDER BY r DESC, a.date DESC
        LIMIT ${RETRIEVAL_POOL}
      ) t
    ),
    vec AS (${vecArm})
    SELECT a.slug, a.title, a.summary, a.date, a.source_domain, a.feed,
      a.story_group,
      (COALESCE(1.0 / (${RRF_K} + lex.rank), 0)
        + COALESCE(1.0 / (${RRF_K} + vec.rank), 0))::real AS score,
      lex.rank::int AS lex_rank,
      vec.rank::int AS vec_rank
    FROM lex
    FULL OUTER JOIN vec USING (slug)
    JOIN articles a USING (slug)
    ORDER BY score DESC, a.date DESC
    LIMIT ${limit}
  `)) as unknown as RetrievalRow[];
}

/**
 * The articles in a window, newest first.
 *
 * The sibling `hybridSearchArticles` cannot answer a question that names a
 * period rather than a topic — "what happened today", "summarise this week".
 * Ranking there is relevance to a query, so a model forced to invent one gets
 * a confidently wrong answer rather than an empty one: `"news"` scoped to a
 * single day returned twelve articles of the 110 filed that day, one of which
 * was among the twelve the day actually led with. Nothing in that result says
 * it is a 1-in-9 sample, so the reader gets a day's summary built from
 * whichever articles happened to sit near the word "news" in vector space.
 *
 * Within a day the order is relevance score, not recency. A day holds more
 * articles than one tool call should return, so the choice is which of them to
 * cut, and the scoring pass already ranks importance — falling back to
 * `created_at` for the articles it has not reached yet.
 */
export async function listArticlesByDate(params: {
  feed?: FeedType | "all";
  from?: string;
  to?: string;
  limit: number;
}): Promise<ArticleRow[]> {
  const { feed, from, to, limit } = params;

  return (await db.execute(sql`
    SELECT a.slug, a.title, a.summary, a.date, a.source_domain, a.feed, a.story_group
    FROM articles a
    WHERE true${retrievalScope({ feed, from, to })}
    ORDER BY a.date DESC, a.relevance_score DESC NULLS LAST, a.created_at DESC
    LIMIT ${limit}
  `)) as unknown as ArticleRow[];
}

/**
 * What the archive actually covers, for the AI reader's system prompt.
 *
 * Without it the model has no idea whether silence on a topic means the
 * archive lacks it or simply predates it, and no way to tell the reader that
 * the most recent article it found is already a week old.
 */
export async function getCorpusCoverage(): Promise<{
  earliest: string;
  latest: string;
  total: number;
} | null> {
  const rows = (await db.execute(sql`
    SELECT MIN(a.date) AS earliest, MAX(a.date) AS latest, COUNT(*)::int AS total
    FROM articles a
    WHERE true${PIPELINE_ONLY}
  `)) as unknown as Array<{ earliest: string | null; latest: string | null; total: number }>;

  const row = rows[0];
  if (!row?.earliest || !row.latest) return null;
  return { earliest: row.earliest, latest: row.latest, total: row.total };
}

// ── Feed sources ──────────────────────────────────────────────────────

/**
 * Every switch the reader has thrown, as `id → enabled`.
 *
 * Sparse by design (see `feedSources` in `schema.ts`), so the caller must treat
 * a missing id as on rather than off — `resolveFeedSources` is the only place
 * that decides that, and everything else should go through it.
 */
export async function getFeedSourceOverrides(): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ id: feedSources.id, enabled: feedSources.enabled })
    .from(feedSources);
  return new Map(rows.map((r) => [r.id, r.enabled]));
}

/**
 * Record the reader's switches, upserting one row per source.
 *
 * Rows are written for `true` as well as `false`. Deleting the row instead
 * would give the same resolved answer today, but it also erases the fact that
 * someone looked at this source and decided to keep it — and `updated_at` is
 * the only record of when a source last changed hands.
 */
export async function setFeedSourceOverrides(
  updates: Record<string, boolean>
): Promise<void> {
  const entries = Object.entries(updates);
  if (entries.length === 0) return;

  await db
    .insert(feedSources)
    .values(entries.map(([id, enabled]) => ({ id, enabled })))
    .onConflictDoUpdate({
      target: feedSources.id,
      set: { enabled: sql`excluded.enabled`, updatedAt: sql`now()` },
    });
}
