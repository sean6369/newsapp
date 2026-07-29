CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("summary", '')), 'B') || setweight(to_tsvector('english', coalesce("content", '')), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "idx_articles_search_vector" ON "articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_articles_title_trgm" ON "articles" USING gin ("title" gin_trgm_ops);