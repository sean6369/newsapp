import { NextRequest, NextResponse } from "next/server";
import { getArticlesWithoutEntities, clearAllEntities } from "@/lib/db/queries";
import { extractAndLinkForArticle } from "@/lib/extractor";

export async function POST(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
  const clear = request.nextUrl.searchParams.get("clear") === "true";
  const date = request.nextUrl.searchParams.get("date") ?? undefined;

  if (clear) {
    await clearAllEntities();
    console.log("[backfill-entities] Cleared all entities");
  }

  const toExtract = await getArticlesWithoutEntities(limit, date);

  if (toExtract.length === 0) {
    return NextResponse.json({ message: "No articles to process", extracted: 0 });
  }

  console.log(`[backfill-entities] Extracting for ${toExtract.length} articles...`);

  let extracted = 0;
  let failed = 0;

  for (const article of toExtract) {
    try {
      const success = await extractAndLinkForArticle(article.slug);
      if (success) {
        extracted++;
        console.log(`[backfill-entities] ${article.title.slice(0, 60)} → done`);
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
      console.error(`[backfill-entities] Failed: ${article.slug}`, error);
    }
  }

  return NextResponse.json({ total: toExtract.length, extracted, failed });
}
