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

  const [dates, lastFetchTime] = await Promise.all([getArticleDates(), getLastFetchTime()]);

  // A feed request that names no day means the newest one, not the whole
  // archive. The client asks that way on every cold load — the date navigator
  // leaves the newest day out of the URL, so there is nothing to read a date
  // from until the first response comes back with one — and answering it
  // literally means sending thousands of articles across every day on record
  // for a page that renders one day of them.
  //
  // Search is the exception: reaching across days is the point of it.
  const date = filters.date ?? (filters.search ? undefined : dates[0]);

  const rawArticles = await queryArticles({ ...filters, date });
  const articles = groupByStory(rawArticles);

  return NextResponse.json({ articles, dates, lastFetchTime });
}
