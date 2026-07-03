import { eq, desc, asc, ilike, or, and, sql, isNull, inArray } from "drizzle-orm";
import { db } from "./index";
import { articles, entities, topics, articleEntities, articleTopics, storylines, storylineArticles } from "./schema";
import type { Article, ArticleFilters, ArticleEntity, Topic, EntityType, EntitySortMode, EntityListItem } from "../types";

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
  if (filters.search) {
    const escaped = filters.search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    conditions.push(
      or(
        ilike(articles.title, `%${escaped}%`),
        ilike(articles.summary, `%${escaped}%`),
        ilike(articles.content, `%${escaped}%`),
        ilike(articles.sourceUrl, `%${escaped}%`)
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
          AND a.date::date >= CURRENT_DATE - INTERVAL '3 days'
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
          AND a.date::date >= CURRENT_DATE - INTERVAL '3 days'
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

// ── Entity & Topic functions ──────────────────────────────────────────

export async function findOrCreateEntity(
  name: string,
  type: EntityType
): Promise<number> {
  // 1. Exact match
  const existing = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.name, name), eq(entities.type, type)))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  // 2. Insert new entity
  const inserted = await db
    .insert(entities)
    .values({ name, type })
    .onConflictDoNothing()
    .returning({ id: entities.id });

  // Race condition: another concurrent insert won — re-query
  if (inserted.length === 0) {
    const retry = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.name, name), eq(entities.type, type)))
      .limit(1);
    if (retry.length === 0) {
      throw new Error(`[entities] Failed to find or create entity: ${name} (${type})`);
    }
    return retry[0].id;
  }

  return inserted[0].id;
}

export async function linkArticleEntity(
  articleSlug: string,
  entityId: number,
  salience: number
): Promise<void> {
  await db
    .insert(articleEntities)
    .values({ articleSlug, entityId, salience })
    .onConflictDoNothing();
}

export async function linkArticleTopic(
  articleSlug: string,
  topicId: number
): Promise<void> {
  await db
    .insert(articleTopics)
    .values({ articleSlug, topicId })
    .onConflictDoNothing();
}

export async function getTopicByName(
  name: string
): Promise<{ id: number } | null> {
  const rows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function seedTopics(topicNames: readonly string[]): Promise<void> {
  for (const name of topicNames) {
    await db.insert(topics).values({ name }).onConflictDoNothing();
  }
}

export async function getEntitiesForArticle(
  slug: string
): Promise<ArticleEntity[]> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      salience: articleEntities.salience,
    })
    .from(articleEntities)
    .innerJoin(entities, eq(articleEntities.entityId, entities.id))
    .where(eq(articleEntities.articleSlug, slug))
    .orderBy(desc(articleEntities.salience));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as EntityType,
    salience: r.salience,
  }));
}

export async function getTopicsForArticle(
  slug: string
): Promise<Topic[]> {
  return db
    .select({ id: topics.id, name: topics.name })
    .from(articleTopics)
    .innerJoin(topics, eq(articleTopics.topicId, topics.id))
    .where(eq(articleTopics.articleSlug, slug));
}

export async function getEntityById(
  id: number
): Promise<{ id: number; name: string; type: EntityType } | null> {
  const rows = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  return rows[0]
    ? { id: rows[0].id, name: rows[0].name, type: rows[0].type as EntityType }
    : null;
}

export async function getArticlesForEntity(
  entityId: number
): Promise<Article[]> {
  const rows = await db
    .select(articleColumns)
    .from(articles)
    .innerJoin(articleEntities, eq(articles.slug, articleEntities.articleSlug))
    .where(eq(articleEntities.entityId, entityId))
    .orderBy(desc(articles.createdAt));
  return rows.map((r) => rowToArticle(r));
}

export async function getArticlesWithoutEntities(
  limit = 50,
  date?: string
): Promise<Array<{ slug: string; title: string; summary: string }>> {
  const dateFilter = date ? sql` AND a.date = ${date}` : sql``;
  const rows = await db.execute(sql`
    SELECT a.slug, a.title, a.summary
    FROM articles a
    LEFT JOIN article_entities ae ON a.slug = ae.article_slug
    WHERE ae.article_slug IS NULL${dateFilter}
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `);
  return rows as unknown as Array<{ slug: string; title: string; summary: string }>;
}

export async function clearAllEntities(): Promise<void> {
  await db.execute(sql`TRUNCATE article_entities, article_topics, entities CASCADE`);
}

export async function getCoOccurringEntities(
  entityId: number,
  minSharedArticles = 2
): Promise<Array<{ entityId: number; name: string; type: string; sharedCount: number }>> {
  const rows = await db.execute(sql`
    SELECT
      e2.id AS entity_id,
      e2.name,
      e2.type,
      COUNT(DISTINCT ae1.article_slug)::int AS shared_count
    FROM article_entities ae1
    JOIN article_entities ae2 ON ae1.article_slug = ae2.article_slug
      AND ae1.entity_id <> ae2.entity_id
    JOIN entities e2 ON ae2.entity_id = e2.id
    WHERE ae1.entity_id = ${entityId}
    GROUP BY e2.id, e2.name, e2.type
    HAVING COUNT(DISTINCT ae1.article_slug) >= ${minSharedArticles}
    ORDER BY shared_count DESC
    LIMIT 10
  `);
  return (rows as unknown as Array<{ entity_id: number; name: string; type: string; shared_count: number }>).map((r) => ({
    entityId: r.entity_id,
    name: r.name,
    type: r.type,
    sharedCount: r.shared_count,
  }));
}

export async function getTrendingEntities(
  hours = 48,
  limit = 20
): Promise<Array<{ id: number; name: string; type: EntityType; score: number; mentionCount: number; previousRank: number | null }>> {
  const previousHours = hours * 2;
  const rows = await db.execute(sql`
    WITH current_ranked AS (
      SELECT e.id, e.name, e.type,
        (AVG(ae.salience) * LN(COUNT(*) + 1))::real AS score,
        COUNT(*)::int AS mention_count,
        RANK() OVER (ORDER BY (AVG(ae.salience) * LN(COUNT(*) + 1)) DESC)::int AS rnk
      FROM article_entities ae
      JOIN entities e ON ae.entity_id = e.id
      JOIN articles a ON ae.article_slug = a.slug
      WHERE a.created_at >= NOW() - INTERVAL '1 hour' * ${hours}
      GROUP BY e.id, e.name, e.type
    ),
    previous_ranked AS (
      SELECT e.id,
        RANK() OVER (ORDER BY (AVG(ae.salience) * LN(COUNT(*) + 1)) DESC)::int AS rnk
      FROM article_entities ae
      JOIN entities e ON ae.entity_id = e.id
      JOIN articles a ON ae.article_slug = a.slug
      WHERE a.created_at >= NOW() - INTERVAL '1 hour' * ${previousHours}
        AND a.created_at < NOW() - INTERVAL '1 hour' * ${hours}
      GROUP BY e.id
    )
    SELECT c.id, c.name, c.type, c.score, c.mention_count,
      p.rnk AS previous_rank
    FROM current_ranked c
    LEFT JOIN previous_ranked p ON c.id = p.id
    ORDER BY c.score DESC
    LIMIT ${limit}
  `);
  return (rows as unknown as Array<{ id: number; name: string; type: string; score: number; mention_count: number; previous_rank: number | null }>).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as EntityType,
    score: r.score,
    mentionCount: r.mention_count,
    previousRank: r.previous_rank,
  }));
}

export async function getAllEntities(options?: {
  type?: EntityType;
  search?: string;
  sort?: EntitySortMode;
  limit?: number;
  offset?: number;
}): Promise<{ entities: EntityListItem[]; total: number }> {
  const { type, search, sort = "trending", limit = 200, offset = 0 } = options ?? {};

  const typeFilter = type ? sql` AND e.type = ${type}` : sql``;
  const searchFilter = search ? sql` AND e.name ILIKE ${"%" + search + "%"}` : sql``;

  const orderClause =
    sort === "alphabetical"
      ? sql`ORDER BY e.name ASC`
      : sort === "mentions"
        ? sql`ORDER BY mention_count DESC, e.name ASC`
        : sort === "recent"
          ? sql`ORDER BY last_seen_at DESC NULLS LAST, e.name ASC`
          : sql`ORDER BY trending_score DESC, mention_count DESC`;

  const rows = await db.execute(sql`
    SELECT
      e.id,
      e.name,
      e.type,
      COUNT(ae.article_slug)::int AS mention_count,
      COALESCE(COUNT(ae.article_slug) FILTER (WHERE a.created_at >= NOW() - INTERVAL '48 hours'), 0)::int AS trending_mention_count,
      COALESCE(SUM(ae.salience), 0)::real AS total_salience,
      (COALESCE(AVG(ae.salience) FILTER (WHERE a.created_at >= NOW() - INTERVAL '48 hours'), 0)
        * LN(COALESCE(COUNT(ae.article_slug) FILTER (WHERE a.created_at >= NOW() - INTERVAL '48 hours'), 0) + 1))::real AS trending_score,
      TO_CHAR(MAX(a.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
      COUNT(*) OVER () AS full_count
    FROM entities e
    LEFT JOIN article_entities ae ON e.id = ae.entity_id
    LEFT JOIN articles a ON ae.article_slug = a.slug
    WHERE 1=1${typeFilter}${searchFilter}
    GROUP BY e.id, e.name, e.type
    HAVING COUNT(ae.article_slug) > 0
    ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  type Row = {
    id: number;
    name: string;
    type: string;
    mention_count: number;
    trending_mention_count: number;
    total_salience: number;
    trending_score: number;
    last_seen_at: string | null;
    full_count: number;
  };

  const typedRows = rows as unknown as Row[];
  const total = typedRows.length > 0 ? Number(typedRows[0].full_count) : 0;

  return {
    entities: typedRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type as EntityType,
      mentionCount: r.mention_count,
      trendingMentionCount: r.trending_mention_count,
      totalSalience: r.total_salience,
      trendingScore: r.trending_score,
      lastSeenAt: r.last_seen_at,
    })),
    total,
  };
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
