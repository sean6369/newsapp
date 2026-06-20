ALTER TABLE "articles" ALTER COLUMN "relevance_score" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "relevance_score" DROP NOT NULL;