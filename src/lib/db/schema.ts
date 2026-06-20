import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  serial,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
  },
  (t) => [
    index("idx_articles_date").on(t.date),
    index("idx_articles_feed").on(t.feed),
    index("idx_articles_category").on(t.category),
    index("idx_articles_relevance").on(t.relevanceScore),
    uniqueIndex("idx_articles_source_url").on(t.sourceUrl),
    index("idx_articles_story_group").on(t.storyGroup),
    uniqueIndex("idx_articles_source_id").on(t.sourceId),
  ]
);

export const entities = pgTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    type: text("type").notNull(),
  },
  (t) => [index("idx_entities_type").on(t.type)]
);

export const articleEntities = pgTable(
  "article_entities",
  {
    articleSlug: text("article_slug")
      .notNull()
      .references(() => articles.slug, { onDelete: "cascade", onUpdate: "cascade" }),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleSlug, t.entityId] })]
);
