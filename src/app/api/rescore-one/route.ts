import { NextRequest, NextResponse } from "next/server";
import { updateRelevanceScore } from "@/lib/db/queries";
import { scoreArticle } from "@/lib/scorer";
import { parseSlugRequest, LOG_TITLE_LEN } from "@/lib/api-utils";

export async function POST(request: NextRequest) {
  const result = await parseSlugRequest(request);
  if ("error" in result) return result.error;

  const { slug, article } = result;

  const score = await scoreArticle({
    title: article.title,
    summary: article.summary,
    category: article.category,
    feed: article.feed,
  });

  // `null` means the call never reached a verdict — most often the daily Gemini
  // quota, which `scoreArticle` short-circuits without leaving the process.
  // Writing it would erase whatever score the article already had, turning a
  // rescore that could not run into a rescore that destroyed data. The pipeline
  // guards its own writes the same way; this route did not.
  if (score === null) {
    console.warn(
      `[rescore-one] No score for ${article.title.slice(0, LOG_TITLE_LEN)} — ` +
        `left at ${article.relevanceScore}`
    );
    return NextResponse.json(
      { error: "Couldn't score that just now — its score is unchanged" },
      { status: 503 }
    );
  }

  await updateRelevanceScore(slug, score);

  console.log(`[rescore-one] ${article.title.slice(0, LOG_TITLE_LEN)} → ${score}`);

  return NextResponse.json({ slug, score });
}
