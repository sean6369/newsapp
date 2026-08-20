ALTER TABLE "articles" ADD COLUMN "library" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_articles_library" ON "articles" USING btree ("created_at") WHERE library;