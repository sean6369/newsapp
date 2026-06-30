CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "thread_evaluated_at" timestamp;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
CREATE INDEX "idx_threads_embedding" ON "threads" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_articles_embedding" ON "articles" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);