ALTER TABLE "articles" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_articles_source_id" ON "articles" ("source_id") WHERE "source_id" IS NOT NULL;
