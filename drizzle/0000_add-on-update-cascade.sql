ALTER TABLE "article_entities"
  DROP CONSTRAINT "article_entities_article_slug_articles_slug_fk";
--> statement-breakpoint
ALTER TABLE "article_entities"
  ADD CONSTRAINT "article_entities_article_slug_articles_slug_fk"
  FOREIGN KEY ("article_slug") REFERENCES "public"."articles"("slug")
  ON DELETE cascade ON UPDATE cascade;
