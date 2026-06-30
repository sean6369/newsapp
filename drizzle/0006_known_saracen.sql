DROP TABLE "thread_articles" CASCADE;--> statement-breakpoint
DROP TABLE "threads" CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_articles_embedding";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN IF EXISTS "embedding";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN IF EXISTS "thread_evaluated_at";