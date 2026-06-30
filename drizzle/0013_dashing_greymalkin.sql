ALTER TABLE "storylines" ADD COLUMN "batch_date" text;--> statement-breakpoint
UPDATE "storylines" SET "batch_date" = to_char(created_at::date, 'YYYY-MM-DD') WHERE "batch_date" IS NULL;--> statement-breakpoint
ALTER TABLE "storylines" ALTER COLUMN "batch_date" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_storylines_batch_date" ON "storylines" USING btree ("batch_date");