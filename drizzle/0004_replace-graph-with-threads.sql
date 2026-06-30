DROP TABLE IF EXISTS "article_entities" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "graph_relations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "graph_entities" CASCADE;--> statement-breakpoint
CREATE TABLE "thread_articles" (
	"thread_id" integer NOT NULL,
	"article_slug" text NOT NULL,
	"development" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thread_articles_thread_id_article_slug_pk" PRIMARY KEY("thread_id","article_slug")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'developing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_articles" ADD CONSTRAINT "thread_articles_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_articles" ADD CONSTRAINT "thread_articles_article_slug_articles_slug_fk" FOREIGN KEY ("article_slug") REFERENCES "public"."articles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_thread_articles_thread" ON "thread_articles" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_threads_status" ON "threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_threads_updated" ON "threads" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN "graphiti_ingested_at";