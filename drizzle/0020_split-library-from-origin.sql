DROP INDEX "idx_articles_library";--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "saved_at" timestamp;--> statement-breakpoint
-- Existing clips were saved when they were created; nothing else has a value.
UPDATE "articles" SET "saved_at" = "created_at" WHERE "library";--> statement-breakpoint
CREATE INDEX "idx_articles_library" ON "articles" USING btree ("saved_at") WHERE library;