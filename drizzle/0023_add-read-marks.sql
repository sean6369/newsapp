CREATE TABLE "read_marks" (
	"slug" text PRIMARY KEY NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "read_marks" ADD CONSTRAINT "read_marks_slug_articles_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."articles"("slug") ON DELETE cascade ON UPDATE no action;