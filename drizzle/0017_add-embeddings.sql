CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "embedded_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_articles_embedding" ON "articles" USING hnsw ("embedding" vector_cosine_ops);