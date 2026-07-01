import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug, deleteArticle } from "@/lib/db/queries";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.slug || typeof body.slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const { slug } = body;

  const article = await getArticleBySlug(slug);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  await deleteArticle(slug);

  console.log(`[delete-article] ${article.title.slice(0, 60)}`);

  return NextResponse.json({ slug });
}
