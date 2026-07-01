import { inArray } from "drizzle-orm";
import { db } from "../src/lib/db/index";
import { articles } from "../src/lib/db/schema";
import { scoreArticle } from "../src/lib/scorer";
import { updateRelevanceScore } from "../src/lib/db/queries";

const dates = process.argv.slice(2);
if (dates.length === 0) {
  console.error("Usage: npx tsx scripts/rescore-dates.ts 2026-06-14 2026-06-15");
  process.exit(1);
}

async function main() {
  // Null out scores for the given dates
  await db
    .update(articles)
    .set({ relevanceScore: null })
    .where(inArray(articles.date, dates));
  console.log(`[rescore] Nulled scores for dates: ${dates.join(", ")}`);

  // Fetch articles to rescore
  const toScore = await db
    .select({
      slug: articles.slug,
      title: articles.title,
      summary: articles.summary,
      category: articles.category,
      feed: articles.feed,
    })
    .from(articles)
    .where(inArray(articles.date, dates));

  console.log(`[rescore] Scoring ${toScore.length} articles...`);

  let scored = 0;
  let failed = 0;

  for (const article of toScore) {
    const score = await scoreArticle(article);
    await updateRelevanceScore(article.slug, score);
    if (score !== null) {
      scored++;
      console.log(`[rescore] ${article.title.slice(0, 60)} → ${score}`);
    } else {
      failed++;
      console.log(`[rescore] ${article.title.slice(0, 60)} → failed`);
    }
  }

  console.log(`[rescore] Done: ${scored} scored, ${failed} failed`);
  process.exit(0);
}

main();
