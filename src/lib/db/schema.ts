import {
  pgTable,
  text,
  integer,
  serial,
  real,
  boolean,
  timestamp,
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
    name: text("name").notNull(),
    type: text("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_entities_name_type").on(t.name, t.type),
    index("idx_entities_type").on(t.type),
  ]
);

export const topics = pgTable(
  "topics",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

export const articleEntities = pgTable(
  "article_entities",
  {
    articleSlug: text("article_slug")
      .notNull()
      .references(() => articles.slug, { onDelete: "cascade" }),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    salience: real("salience"),
  },
  (t) => [
    uniqueIndex("idx_article_entities_pk").on(t.articleSlug, t.entityId),
    index("idx_article_entities_entity").on(t.entityId),
  ]
);

export const articleTopics = pgTable(
  "article_topics",
  {
    articleSlug: text("article_slug")
      .notNull()
      .references(() => articles.slug, { onDelete: "cascade" }),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("idx_article_topics_pk").on(t.articleSlug, t.topicId),
    index("idx_article_topics_topic").on(t.topicId),
  ]
);

export const storylines = pgTable(
  "storylines",
  {
    id: serial("id").primaryKey(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    fullStory: text("full_story").notNull(),
    batchDate: text("batch_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_storylines_created").on(t.createdAt),
    index("idx_storylines_batch_date").on(t.batchDate),
  ]
);

export const storylineArticles = pgTable(
  "storyline_articles",
  {
    storylineId: integer("storyline_id")
      .notNull()
      .references(() => storylines.id, { onDelete: "cascade" }),
    articleSlug: text("article_slug")
      .notNull()
      .references(() => articles.slug, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("idx_storyline_articles_pk").on(t.storylineId, t.articleSlug),
    index("idx_storyline_articles_storyline").on(t.storylineId),
  ]
);
