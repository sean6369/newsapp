-- Required before the columns and indexes below: `vector` for the embedding
-- column, `pg_trgm` for the gin_trgm_ops indexes. Also created by
-- db/init.sql, but that only runs when Postgres initialises a fresh volume,
-- so a migration run against any other database needs them here.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "articles" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"source_domain" text NOT NULL,
	"summary" text NOT NULL,
	"category" text NOT NULL,
	"feed" text NOT NULL,
	"date" text NOT NULL,
	"reading_time" integer DEFAULT 0 NOT NULL,
	"clipped" boolean DEFAULT false NOT NULL,
	"library" boolean DEFAULT false NOT NULL,
	"saved_at" timestamp,
	"content" text,
	"relevance_score" real,
	"story_group" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"source_id" text,
	"updated_at" timestamp,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("summary", '')), 'B') || setweight(to_tsvector('english', coalesce("content", '')), 'C')) STORED,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_marks" (
	"slug" text PRIMARY KEY NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "read_marks" ADD CONSTRAINT "read_marks_slug_articles_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."articles"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_articles_date" ON "articles" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_articles_feed" ON "articles" USING btree ("feed");--> statement-breakpoint
CREATE INDEX "idx_articles_category" ON "articles" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_articles_relevance" ON "articles" USING btree ("relevance_score");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_articles_source_url" ON "articles" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "idx_articles_story_group" ON "articles" USING btree ("story_group");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_articles_source_id" ON "articles" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_articles_search_vector" ON "articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_articles_title_trgm" ON "articles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_articles_domain_trgm" ON "articles" USING gin ("source_domain" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_articles_embedding" ON "articles" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_articles_library" ON "articles" USING btree ("saved_at") WHERE library;--> statement-breakpoint
CREATE INDEX "idx_conversations_updated_at" ON "conversations" USING btree ("updated_at");