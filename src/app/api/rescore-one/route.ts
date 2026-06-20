import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug, updateRelevanceScore } from "@/lib/db/queries";
import { scoreArticle } from "@/lib/scorer";

export async function POST(request: NextRequest) {
  const { slug } = await request.json();

  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const article = await getArticleBySlug(slug);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const score = await scoreArticle({
    title: article.title,
    summary: article.summary,
    category: article.category,
    feed: article.feed,
  });

  await updateRelevanceScore(slug, score);

  console.log(`[rescore-one] ${article.title.slice(0, 60)} → ${score}`);

  return NextResponse.json({ slug, score });
}
