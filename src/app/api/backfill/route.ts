import { NextRequest, NextResponse } from "next/server";
import { getUnscoredArticles, getAllArticlesForScoring, updateRelevanceScore } from "@/lib/db/queries";
import { scoreArticle } from "@/lib/scorer";

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_PIPELINE === "false") {
    return NextResponse.json({ message: "Pipeline disabled" });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";
  const toScore = force ? await getAllArticlesForScoring() : await getUnscoredArticles();

  if (toScore.length === 0) {
    return NextResponse.json({ message: "No articles to score", scored: 0 });
  }

  console.log(`[backfill] Scoring ${toScore.length} articles${force ? " (force rescore)" : ""}...`);

  let scored = 0;
  let failed = 0;

  for (const article of toScore) {
    try {
      const score = await scoreArticle(article);
      await updateRelevanceScore(article.slug, score);
      if (score !== null) {
        scored++;
        console.log(`[backfill] ${article.title.slice(0, 60)} → ${score}`);
      } else {
        failed++;
        console.log(`[backfill] ${article.title.slice(0, 60)} → failed`);
      }
    } catch (error) {
      failed++;
      console.error(`[backfill] Failed to score: ${article.slug}`, error);
    }
  }

  console.log(`[backfill] Done: ${scored} scored, ${failed} failed`);

  return NextResponse.json({
    total: toScore.length,
    scored,
    failed,
  });
}
