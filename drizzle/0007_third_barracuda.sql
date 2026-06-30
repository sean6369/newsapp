ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "lightrag_indexed_at" timestamp;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "lightrag_doc_id" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "lightrag_status" text;--> statement-breakpoint
UPDATE articles SET lightrag_status = 'indexed' WHERE lightrag_indexed_at IS NOT NULL;--> statement-breakpoint
UPDATE articles SET lightrag_status = 'pending' WHERE lightrag_indexed_at IS NULL AND content IS NOT NULL;
