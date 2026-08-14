import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  customType,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../gemini";

/**
 * Postgres `tsvector`. Only ever written by the database (generated column), so
 * the TS-side type is a plain string we never read directly.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const articles = pgTable(
  "articles",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceDomain: text("source_domain").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    feed: text("feed").notNull(),
    date: text("date").notNull(),
    readingTime: integer("reading_time").default(0).notNull(),
    clipped: boolean("clipped").default(false).notNull(),
    content: text("content"),
    relevanceScore: real("relevance_score"),
    storyGroup: text("story_group"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sourceId: text("source_id"),
    updatedAt: timestamp("updated_at"),
    // Weighted full-text index over the article. Title matches outrank summary
    // matches, which outrank body matches, via ts_rank_cd's weight vector.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("summary", '')), 'B') || setweight(to_tsvector('english', coalesce("content", '')), 'C')`
    ),
    // Semantic half of the retrieval used by the AI reader. Null until the
    // pipeline (or a backfill pass) embeds the row, mirroring how
    // `relevance_score` is left null for a later pass to fill.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    // Which model produced `embedding`. Vectors from different models are not
    // comparable, so a mixed column silently degrades ranking rather than
    // failing — this is what makes stale rows findable after a model change.
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at"),
  },
  (t) => [
    index("idx_articles_date").on(t.date),
    index("idx_articles_feed").on(t.feed),
    index("idx_articles_category").on(t.category),
    index("idx_articles_relevance").on(t.relevanceScore),
    uniqueIndex("idx_articles_source_url").on(t.sourceUrl),
    index("idx_articles_story_group").on(t.storyGroup),
    uniqueIndex("idx_articles_source_id").on(t.sourceId),
    index("idx_articles_search_vector").using("gin", t.searchVector),
    // Trigram index backing the typo-tolerant fallback (`title <% query`).
    index("idx_articles_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
    // Lets the feed's `search_vector @@ ... OR source_domain ILIKE ...` resolve
    // as a BitmapOr across both indexes instead of falling back to a seq scan.
    index("idx_articles_domain_trgm").using("gin", sql`${t.sourceDomain} gin_trgm_ops`),
    // HNSW rather than the IVFFlat this column carried in an earlier life:
    // IVFFlat needs representative rows to train its lists and periodic
    // rebuilds as the corpus grows, and under-performs a sequential scan at
    // this size. HNSW needs neither.
    index("idx_articles_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ]
);
