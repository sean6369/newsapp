import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug, getArticleContent } from "@/lib/db/queries";
import { buildArticleMarkdownHeader } from "@/lib/articles";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
  }

  const article = await getArticleBySlug(slug);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const content = (await getArticleContent(slug)) ?? article.summary;
  const header = buildArticleMarkdownHeader(article);

  return new NextResponse(header + content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug.replace(/["\\\r\n]/g, "")}.md"`,
    },
  });
}
