import { eq, desc, asc, ilike, or, and, sql, isNull } from "drizzle-orm";
import { db } from "./index";
import { articles } from "./schema";
import type { Article, ArticleFilters } from "../types";

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
): Promise<void> {
  await db
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
    .onConflictDoNothing();
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
    conditions.push(
      or(
        ilike(articles.title, `%${filters.search}%`),
        ilike(articles.summary, `%${filters.search}%`),
        ilike(articles.content, `%${filters.search}%`),
        ilike(articles.sourceUrl, `%${filters.search}%`)
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

export async function articleExists(slug: string, sourceUrl?: string): Promise<boolean> {
  const conditions = [eq(articles.slug, slug)];
  if (sourceUrl) {
    conditions.push(eq(articles.sourceUrl, sourceUrl));
  }
  const rows = await db
    .select({ slug: articles.slug })
    .from(articles)
    .where(or(...conditions))
    .limit(1);
  return rows.length > 0;
}

export async function getArticleBySourceUrl(
  sourceUrl: string
): Promise<{ slug: string; title: string; sourceUrl: string } | null> {
  const rows = await db
    .select({ slug: articles.slug, title: articles.title, sourceUrl: articles.sourceUrl })
    .from(articles)
    .where(eq(articles.sourceUrl, sourceUrl))
    .limit(1);
  return rows[0] ?? null;
}

export async function getArticleBySourceId(
  sourceId: string
): Promise<{ slug: string; title: string; sourceUrl: string } | null> {
  const rows = await db
    .select({ slug: articles.slug, title: articles.title, sourceUrl: articles.sourceUrl })
    .from(articles)
    .where(eq(articles.sourceId, sourceId))
    .limit(1);
  return rows[0] ?? null;
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
  if (updates.content !== undefined) setClause.content = updates.content;

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
  // eslint-disable-next-line no-constant-condition
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
