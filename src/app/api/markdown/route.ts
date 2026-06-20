import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug, getArticleContent } from "@/lib/db/queries";

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

  const header = [
    `# ${article.title}`,
    "",
    `- **Source:** [${article.sourceDomain}](${article.sourceUrl})`,
    `- **Date:** ${article.date}`,
    `- **Feed:** ${article.feed}`,
    `- **Reading time:** ${article.readingTime} min`,
    "",
    "---",
    "",
  ].join("\n");

  return new NextResponse(header + content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.md"`,
    },
  });
}
