CREATE TABLE "article_entities" (
	"article_slug" text NOT NULL,
	"entity_id" integer NOT NULL,
	"salience" real
);
--> statement-breakpoint
CREATE TABLE "article_topics" (
	"article_slug" text NOT NULL,
	"topic_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "topics_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "article_entities" ADD CONSTRAINT "article_entities_article_slug_articles_slug_fk" FOREIGN KEY ("article_slug") REFERENCES "public"."articles"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_entities" ADD CONSTRAINT "article_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_article_slug_articles_slug_fk" FOREIGN KEY ("article_slug") REFERENCES "public"."articles"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_article_entities_pk" ON "article_entities" USING btree ("article_slug","entity_id");--> statement-breakpoint
CREATE INDEX "idx_article_entities_entity" ON "article_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_article_topics_pk" ON "article_topics" USING btree ("article_slug","topic_id");--> statement-breakpoint
CREATE INDEX "idx_article_topics_topic" ON "article_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_entities_name_type" ON "entities" USING btree ("name","type");--> statement-breakpoint
CREATE INDEX "idx_entities_type" ON "entities" USING btree ("type");--> statement-breakpoint
INSERT INTO "topics" ("name") VALUES
  ('AI & Machine Learning'),
  ('Cloud & Infrastructure'),
  ('Cybersecurity'),
  ('Developer Tools'),
  ('Hardware & Chips'),
  ('Software & Apps'),
  ('Startups & VC'),
  ('Singapore Politics'),
  ('Singapore Economy'),
  ('Singapore Transport'),
  ('Singapore Housing'),
  ('Singapore Education'),
  ('Singapore Defence & Security'),
  ('US Politics'),
  ('China Affairs'),
  ('Southeast Asia'),
  ('Europe'),
  ('Geopolitics & Diplomacy'),
  ('Middle East'),
  ('Markets & Investing'),
  ('Cryptocurrency'),
  ('Banking & Finance'),
  ('Corporate News'),
  ('Climate & Environment'),
  ('Health & Medicine'),
  ('Science & Research'),
  ('Law & Crime'),
  ('Weather'),
  ('Energy')
ON CONFLICT DO NOTHING;