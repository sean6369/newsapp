import { db } from "../src/lib/db/index";
import { articles } from "../src/lib/db/schema";
import { scoreArticle } from "../src/lib/scorer";
import { updateRelevanceScore } from "../src/lib/db/queries";
import { ilike } from "drizzle-orm";

const search = process.argv[2];
if (!search) {
  console.error("Usage: npx tsx scripts/rescore-one.ts <title search>");
  process.exit(1);
}

async function main() {
  const rows = await db
    .select({ slug: articles.slug, title: articles.title, summary: articles.summary, category: articles.category, feed: articles.feed })
    .from(articles)
    .where(ilike(articles.title, `%${search}%`));

  if (rows.length === 0) {
    console.log("No article found matching:", search);
    process.exit(1);
  }

  const a = rows[0];
  console.log("Title:", a.title);
  console.log("Summary:", a.summary.slice(0, 200));
  console.log("Feed:", a.feed, "| Category:", a.category);
  console.log("");

  const score = await scoreArticle(a);
  if (score !== null) {
    await updateRelevanceScore(a.slug, score);
    console.log("Score:", score);
  } else {
    console.log("Failed again");
  }
  process.exit(0);
}

main();
