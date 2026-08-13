import { eq, ne, desc, asc, ilike, or, and, sql, isNull, inArray } from "drizzle-orm";
import { db } from "./index";
import { articles, storylines, storylineArticles } from "./schema";
import { EMBEDDING_MODEL } from "../gemini";
import type { Article, ArticleFilters, FeedType, SearchFilters, SearchResponse, SearchResultArticle } from "../types";
import { groupByStory } from "../group-stories";

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
  const conditions = [];

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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy);

  return rows.map((r) => rowToArticle(r));
}

export async function getLastFetchTime(): Promise<string | null> {
  const rows = await db
    .select({ createdAt: articles.createdAt })
    .from(articles)
    .orderBy(desc(articles.createdAt))
    .limit(1);
  return rows[0]?.createdAt?.toISOString() ?? null;
}

export async function getArticleDates(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: articles.date })
    .from(articles)
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
  return db.select(scoringColumns).from(articles).where(isNull(articles.relevanceScore));
}

export async function getAllArticlesForScoring(): Promise<ArticleForScoring[]> {
  return db.select(scoringColumns).from(articles);
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
      or(isNull(articles.embedding), ne(articles.embeddingModel, EMBEDDING_MODEL))
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
export async function getAllArticlesForEmbedding(): Promise<ArticleForEmbedding[]> {
  return db
    .select(embeddingColumns)
    .from(articles)
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

type ExistingArticleRow = { slug: string; title: string; sourceUrl: string };

export async function getExistingArticles(
  sourceIds: string[],
  sourceUrls: string[]
): Promise<{
  bySourceId: Map<string, ExistingArticleRow>;
  bySourceUrl: Map<string, ExistingArticleRow>;
}> {
  const cols = { slug: articles.slug, title: articles.title, sourceUrl: articles.sourceUrl, sourceId: articles.sourceId };
  const bySourceId = new Map<string, ExistingArticleRow>();
  const bySourceUrl = new Map<string, ExistingArticleRow>();

  if (sourceIds.length === 0) return { bySourceId, bySourceUrl };

  // Primary: batch lookup by sourceId
  const byId = await db.select(cols).from(articles).where(inArray(articles.sourceId, sourceIds));
  const matchedSourceIds = new Set<string>();
  for (const r of byId) {
    if (!r.sourceId) continue;
    bySourceId.set(r.sourceId, r);
    matchedSourceIds.add(r.sourceId);
  }

  // Fallback: batch lookup by sourceUrl for unmatched articles (pre-backfill rows)
  const unmatchedUrls = sourceUrls.filter((_, i) => !matchedSourceIds.has(sourceIds[i]));
  if (unmatchedUrls.length > 0) {
    const byUrl = await db.select(cols).from(articles).where(inArray(articles.sourceUrl, unmatchedUrls));
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
    feed: row.feed as "tech" | "ai" | "singapore" | "world" | "asia" | "finance",
    date: row.date,
    readingTime: row.readingTime,
    clipped: row.clipped,
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
  a.feed, a.date, a.reading_time, a.clipped, a.relevance_score,
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

  const feedFilter = feed && feed !== "all" ? sql` AND a.feed = ${feed}` : sql``;
  const fromFilter = from ? sql` AND a.date >= ${from}` : sql``;
  const toFilter = to ? sql` AND a.date <= ${to}` : sql``;
  const scopeFilter = sql`${feedFilter}${fromFilter}${toFilter}`;

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
    WHERE a.search_vector @@ q.tsq${scopeFilter}
    ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as SearchRow[];

  if (ftsRows.length > 0) {
    return {
      results: groupByStory(ftsRows.map(searchRowToArticle), feed),
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
        WHERE a.search_vector @@ websearch_to_tsquery('english', ${trimmed})${scopeFilter}
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

  return {
    results: groupByStory(fuzzyRows.map(searchRowToArticle), feed),
    total: Number(fuzzyRows[0].full_count),
    rowCount: fuzzyRows.length,
    mode: "fuzzy",
  };
}

/**
 * How far back story matching looks. `articles.date` is text in `YYYY-MM-DD`,
 * where lexicographic order matches chronological order, so comparing as text
 * keeps `idx_articles_date` usable — casting the column to `date` per row would
 * not.
 */
const RECENT_CUTOFF = sql`to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')`;

export async function matchStories(): Promise<number> {
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
          COALESCE(
            b.story_group,
            CASE WHEN COALESCE(a.relevance_score, 0) > COALESCE(b.relevance_score, 0) THEN a.slug
                 WHEN COALESCE(b.relevance_score, 0) > COALESCE(a.relevance_score, 0) THEN b.slug
                 ELSE LEAST(a.slug, b.slug) END
          ) AS target_group
        FROM articles a
        JOIN articles b ON a.slug <> b.slug
          AND a.date = b.date
          AND similarity(a.title, b.title) >
            CASE WHEN a.source_domain = b.source_domain THEN 0.7 ELSE 0.5 END
        WHERE a.story_group IS NULL
          AND a.date >= ${RECENT_CUTOFF}
          -- Implied by a.date = b.date, but stating it lets the planner bound
          -- both sides with idx_articles_date instead of scanning all of b.
          AND b.date >= ${RECENT_CUTOFF}
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
          AND a.date >= ${RECENT_CUTOFF}
          AND b.date >= ${RECENT_CUTOFF}
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

export async function getArticlesByStoryGroup(storyGroup: string): Promise<Article[]> {
  const rows = await db
    .select(articleColumns)
    .from(articles)
    .where(eq(articles.storyGroup, storyGroup));
  return rows.map((r) => rowToArticle(r));
}

// ── Storyline functions ───────────────────────────────────────────────

export async function getRecentArticles(): Promise<Array<{ slug: string; title: string; summary: string; content: string | null; sourceDomain: string }>> {
  const rows = await db.execute(sql`
    SELECT slug, title, summary, content, source_domain AS "sourceDomain"
    FROM articles
    WHERE date >= to_char((NOW() AT TIME ZONE 'Asia/Singapore')::date - 3, 'YYYY-MM-DD')
      AND date < to_char((NOW() AT TIME ZONE 'Asia/Singapore')::date, 'YYYY-MM-DD')
    ORDER BY date DESC, created_at DESC
  `);
  return rows as unknown as Array<{ slug: string; title: string; summary: string; content: string | null; sourceDomain: string }>;
}

export async function insertStoryline(
  headline: string,
  summary: string,
  fullStory: string,
  articleSlugs: string[],
  batchDate: string
): Promise<number> {
  const [row] = await db
    .insert(storylines)
    .values({ headline, summary, fullStory, batchDate })
    .returning({ id: storylines.id });

  const uniqueSlugs = [...new Set(articleSlugs)];
  if (uniqueSlugs.length > 0) {
    await db.insert(storylineArticles).values(
      uniqueSlugs.map((slug) => ({ storylineId: row.id, articleSlug: slug }))
    );
  }

  return row.id;
}

export async function deleteStorylinesByBatch(batchDate: string): Promise<void> {
  await db.delete(storylines).where(eq(storylines.batchDate, batchDate));
}

export async function getTopStorylines(): Promise<{
  storylines: Array<{
    id: number;
    headline: string;
    summary: string;
    articleCount: number;
    recentArticleCount: number;
  }>;
  generatedAt: Date | null;
}> {
  const rows = await db.execute(sql`
    SELECT
      s.id,
      s.headline,
      s.summary,
      s.created_at AT TIME ZONE 'UTC' AS created_at,
      (SELECT COUNT(*)::int FROM storyline_articles sa WHERE sa.storyline_id = s.id) AS article_count,
      (SELECT COUNT(*)::int FROM storyline_articles sa
        JOIN articles a ON sa.article_slug = a.slug
        WHERE sa.storyline_id = s.id
          AND a.date = to_char((NOW() AT TIME ZONE 'Asia/Singapore')::date - 1, 'YYYY-MM-DD')) AS recent_article_count
    FROM storylines s
    WHERE s.batch_date = (SELECT MAX(batch_date) FROM storylines)
    ORDER BY s.id
  `);
  const typed = rows as unknown as Array<{
    id: number;
    headline: string;
    summary: string;
    created_at: Date;
    article_count: number;
    recent_article_count: number;
  }>;
  return {
    storylines: typed.map((r) => ({
      id: r.id,
      headline: r.headline,
      summary: r.summary,
      articleCount: r.article_count,
      recentArticleCount: r.recent_article_count,
    })),
    generatedAt: typed.length > 0 ? new Date(typed[0].created_at) : null,
  };
}

export async function getStorylineById(id: number): Promise<{
  id: number;
  headline: string;
  summary: string;
  fullStory: string;
  articles: Article[];
} | null> {
  const [row] = await db
    .select({
      id: storylines.id,
      headline: storylines.headline,
      summary: storylines.summary,
      fullStory: storylines.fullStory,
    })
    .from(storylines)
    .where(eq(storylines.id, id))
    .limit(1);

  if (!row) return null;

  const articleRows = await db
    .select(articleColumns)
    .from(storylineArticles)
    .innerJoin(articles, eq(storylineArticles.articleSlug, articles.slug))
    .where(eq(storylineArticles.storylineId, id))
    .orderBy(desc(articles.createdAt));

  return {
    id: row.id,
    headline: row.headline,
    summary: row.summary,
    fullStory: row.fullStory,
    articles: articleRows.map((r) => rowToArticle(r)),
  };
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

export type RetrievalRow = {
  slug: string;
  title: string;
  summary: string;
  date: string;
  source_domain: string;
  feed: string;
  story_group: string | null;
  score: number;
  lex_rank: number | null;
  vec_rank: number | null;
};

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

  const feedFilter = feed && feed !== "all" ? sql` AND a.feed = ${feed}` : sql``;
  const fromFilter = from ? sql` AND a.date >= ${from}` : sql``;
  const toFilter = to ? sql` AND a.date <= ${to}` : sql``;
  const scopeFilter = sql`${feedFilter}${fromFilter}${toFilter}`;

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
          WHERE a.embedding IS NOT NULL${scopeFilter}
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
    SELECT MIN(date) AS earliest, MAX(date) AS latest, COUNT(*)::int AS total
    FROM articles
  `)) as unknown as Array<{ earliest: string | null; latest: string | null; total: number }>;

  const row = rows[0];
  if (!row?.earliest || !row.latest) return null;
  return { earliest: row.earliest, latest: row.latest, total: row.total };
}
