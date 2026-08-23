import { NextRequest, NextResponse } from "next/server";
import { getFeedPayload } from "@/lib/feed-payload";
import type { ArticleFilters } from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const filters: ArticleFilters = {
    feed: (searchParams.get("feed") as ArticleFilters["feed"]) || "all",
    date: searchParams.get("date") || undefined,
    search: searchParams.get("search") || undefined,
    sort: (searchParams.get("sort") as ArticleFilters["sort"]) || "date-desc",
  };

  return NextResponse.json(await getFeedPayload(filters));
}
