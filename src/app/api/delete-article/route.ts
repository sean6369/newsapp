import { NextRequest, NextResponse } from "next/server";
import { deleteArticle } from "@/lib/db/queries";
import { parseSlugRequest, LOG_TITLE_LEN } from "@/lib/api-utils";

export async function POST(request: NextRequest) {
  const result = await parseSlugRequest(request);
  if ("error" in result) return result.error;

  const { slug, article } = result;

  await deleteArticle(slug);

  console.log(`[delete-article] ${article.title.slice(0, LOG_TITLE_LEN)}`);

  return NextResponse.json({ slug });
}
