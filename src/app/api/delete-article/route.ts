import { NextRequest, NextResponse } from "next/server";
import { deleteArticle } from "@/lib/db/queries";
import { parseSlugRequest, LOG_TITLE_LEN } from "@/lib/api-utils";

export async function POST(request: NextRequest) {
  const result = await parseSlugRequest(request);
  if ("error" in result) return result.error;

  const { slug, article } = result;

  await deleteArticle(slug);

  console.log(
    `[delete-article] ${article.title.slice(0, LOG_TITLE_LEN)}` +
      (article.library ? " (was in the library)" : "")
  );

  // This is a hard delete of the row, so an article the reader had saved goes
  // with it. Reported rather than prevented — deleting from the feed means
  // "remove this article", and the library page has its own gentler removal —
  // but the reader should not have to notice on their own.
  return NextResponse.json({ slug, wasInLibrary: article.library });
}
