import { NextRequest, NextResponse } from "next/server";
import { queryArticles, getArticleDates, getLastFetchTime } from "@/lib/db/queries";
import { groupByStory } from "@/lib/group-stories";
import type { ArticleFilters } from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const filters: ArticleFilters = {
    feed: (searchParams.get("feed") as ArticleFilters["feed"]) || "all",
    date: searchParams.get("date") || undefined,
    search: searchParams.get("search") || undefined,
    sort: (searchParams.get("sort") as ArticleFilters["sort"]) || "date-desc",
  };

  const [rawArticles, dates, lastFetchTime] = await Promise.all([
    queryArticles(filters),
    getArticleDates(),
    getLastFetchTime(),
  ]);

  const articles = groupByStory(rawArticles, filters.feed);

  return NextResponse.json({ articles, dates, lastFetchTime });
}
