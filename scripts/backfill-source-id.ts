import { isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db/index";
import { articles } from "../src/lib/db/schema";
import { extractSourceId } from "../src/lib/articles";

async function main() {
  const rows = await db
    .select({
      slug: articles.slug,
      sourceUrl: articles.sourceUrl,
    })
    .from(articles)
    .where(isNull(articles.sourceId));

  console.log(`[backfill] Found ${rows.length} articles without sourceId`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const sourceId = extractSourceId(row.sourceUrl);

    const result = await db
      .update(articles)
      .set({ sourceId })
      .where(
        sql`${articles.slug} = ${row.slug} AND NOT EXISTS (
          SELECT 1 FROM articles a2 WHERE a2.source_id = ${sourceId} AND a2.slug != ${row.slug}
        )`
      );

    if (Number(result.count ?? 0) > 0) {
      updated++;
    } else {
      skipped++;
      console.warn(`[backfill] Skipped ${row.slug}: duplicate sourceId ${sourceId}`);
    }
  }

  console.log(`[backfill] Done: ${updated} updated, ${skipped} skipped`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
