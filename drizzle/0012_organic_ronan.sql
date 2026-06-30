ALTER TABLE "storylines" DROP CONSTRAINT "storylines_entity_id_entities_id_fk";
--> statement-breakpoint
DROP INDEX "idx_storylines_entity";--> statement-breakpoint
ALTER TABLE "storylines" DROP COLUMN "entity_id";