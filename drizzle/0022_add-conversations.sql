CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_conversations_updated_at" ON "conversations" USING btree ("updated_at");