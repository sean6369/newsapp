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

  await updateRelevanceScore(slug, score);

  console.log(`[rescore-one] ${article.title.slice(0, LOG_TITLE_LEN)} → ${score}`);

  return NextResponse.json({ slug, score });
}
