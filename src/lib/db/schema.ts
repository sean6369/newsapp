import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../gemini";
import type { ChatMessage } from "../types";

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
    /**
     * True for anything in the reader's library, however it got there.
     *
     * Deliberately *not* the same question as "did the pipeline fetch this".
     * An article can be both a Straits Times story in Thursday's feed and one
     * the reader kept, and an earlier version of this column tried to mean both
     * things at once — which made saving a feed article impossible to express,
     * since flagging it would have deleted it from the feed it still belongs
     * to.
     *
     * Origin is recorded by `feed` instead: `library` there means the reader
     * pasted it and no RSS feed carries it. That is what the home page,
     * scoring, embedding, and the Ask retrieval filter on — via `pipelineOnly`
     * / `PIPELINE_ONLY` in `queries.ts`, which is the only place to add it.
     * This column is what `/library` lists.
     */
    library: boolean("library").default(false).notNull(),
    /**
     * When the reader added it to their library. Null for everything else.
     *
     * `created_at` cannot order the library once feed articles can be saved:
     * for those it records when the pipeline ingested the story, so an article
     * from last week saved this morning would sort a week down the page.
     */
    savedAt: timestamp("saved_at"),
    content: text("content"),
    relevanceScore: real("relevance_score"),
    /**
     * Which story an article belongs to, shared by every article covering it.
     * The value is one member's slug, but treat it as opaque: it is only ever
     * compared for equality, and deleting that member leaves the survivors
     * pointing at a slug that no longer exists. Never join it to `slug`.
     *
     * Null is the normal resting state — most articles are the only report of
     * their story. Assigned by `matchStories`, which groups only within a
     * single `date`, so a group never spans days.
     */
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
    // Partial: the library is a handful of rows in a table of news, and this is
    // the only query that wants them. Indexing `saved_at` under the predicate
    // means the library page is an index scan already in its display order.
    index("idx_articles_library").on(t.savedAt).where(sql`library`),
  ]
);

/**
 * Which sources the reader has switched off, and nothing else.
 *
 * Deliberately sparse: a row exists only for a source someone has actually
 * toggled, and `FEED_SOURCES` in `lib/feed-sources.ts` remains the list of what
 * exists. Storing the full roster here instead would mean every new source
 * needed a migration to seed it — and a source added to the code but missing
 * from the table would silently never be fetched, which is the failure mode
 * hardest to notice: the feed just quietly stops carrying one outlet.
 *
 * `enabled` is therefore an override, not the state. Absent means on.
 */
export const feedSources = pgTable("feed_sources", {
  /** Matches `FeedSource.id` in the registry. */
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * One Ask conversation, whole.
 *
 * The thread is stored as a single `jsonb` document rather than a row per
 * message, because nothing ever queries *into* a conversation: the list needs
 * the title and when it last moved, and opening one needs all of it. A
 * messages table would buy per-message addressing this app has no use for, at
 * the cost of a join and an ordering column on every read.
 *
 * What that document holds is `ChatMessage[]` exactly as the client renders
 * it — retrieval steps and article cards included. Storing only the prose
 * would mean a reopened chat lost its working and its sources, which is most
 * of what distinguishes an Ask answer from a chat log. It also means the shape
 * is the client's: `sanitiseMessages` in `lib/conversations` is what stands
 * between a POST body and this column.
 *
 * `/api/ask` stays stateless. It is still handed the full thread on every
 * question and still stores nothing itself — this table is written by the
 * page after an answer completes, so history is a record of conversations
 * rather than a thing the model participates in.
 */
export const conversations = pgTable(
  "conversations",
  {
    /** A UUID minted by the browser when the first answer lands. */
    id: text("id").primaryKey(),
    /**
     * The label the drawer lists it under, written once from the opening
     * exchange and never revised — see `generateConversationTitle`. A title
     * that re-summarised as the chat grew would rename rows the reader had
     * already learned to find.
     */
    title: text("title").notNull(),
    messages: jsonb("messages").$type<ChatMessage[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** Last exchange, which is the order the drawer lists them in. */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  // The list is every row in `updated_at` order, so the index is the list.
  (t) => [index("idx_conversations_updated_at").on(t.updatedAt)]
);
