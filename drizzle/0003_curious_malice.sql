ALTER TABLE "article_entities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "article_entities" CASCADE;--> statement-breakpoint
DROP TABLE "entities" CASCADE;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "graphiti_ingested_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_articles_source_id" ON "articles" USING btree ("source_id");