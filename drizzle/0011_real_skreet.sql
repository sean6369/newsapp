ALTER TABLE "storylines" DROP CONSTRAINT "storylines_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "storylines" ALTER COLUMN "entity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storylines" ADD CONSTRAINT "storylines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;