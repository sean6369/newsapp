import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug, deleteArticle } from "@/lib/db/queries";

export async function POST(request: NextRequest) {
  const { slug } = await request.json();

  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const article = await getArticleBySlug(slug);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  await deleteArticle(slug);

  console.log(`[delete-article] ${article.title.slice(0, 60)}`);

  return NextResponse.json({ slug });
}
