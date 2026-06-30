CREATE TABLE "storyline_articles" (
	"storyline_id" integer NOT NULL,
	"article_slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storylines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"full_story" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storyline_articles" ADD CONSTRAINT "storyline_articles_storyline_id_storylines_id_fk" FOREIGN KEY ("storyline_id") REFERENCES "public"."storylines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyline_articles" ADD CONSTRAINT "storyline_articles_article_slug_articles_slug_fk" FOREIGN KEY ("article_slug") REFERENCES "public"."articles"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storylines" ADD CONSTRAINT "storylines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_storyline_articles_pk" ON "storyline_articles" USING btree ("storyline_id","article_slug");--> statement-breakpoint
CREATE INDEX "idx_storyline_articles_storyline" ON "storyline_articles" USING btree ("storyline_id");--> statement-breakpoint
CREATE INDEX "idx_storylines_entity" ON "storylines" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_storylines_created" ON "storylines" USING btree ("created_at");