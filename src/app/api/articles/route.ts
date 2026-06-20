import { NextRequest, NextResponse } from "next/server";
import { queryArticles, getArticleDates, getLastFetchTime } from "@/lib/db/queries";
import type { ArticleFilters, Article, ArticleWithRelated } from "@/lib/types";

function groupByStory(articles: Article[], feedFilter?: string): ArticleWithRelated[] {
  // Build a map of storyGroup → all articles in that group
  const storyGroupMap = new Map<string, Article[]>();
  for (const article of articles) {
    if (article.storyGroup) {
      const group = storyGroupMap.get(article.storyGroup) || [];
      group.push(article);
      storyGroupMap.set(article.storyGroup, group);
    }
  }

  // Walk the original array in order (preserving DB sort) and attach
  // related articles. Skip secondary articles that were already attached.
  const seen = new Set<string>();
  const result: ArticleWithRelated[] = [];
  const isFiltered = feedFilter && feedFilter !== "all";

  for (const article of articles) {
    if (seen.has(article.slug)) continue;
    seen.add(article.slug);

    if (article.storyGroup) {
      const group = storyGroupMap.get(article.storyGroup)!;
      const related = group.filter((a) => a.slug !== article.slug);

      // Cross-feed groups only merge in the "All" tab.
      // In a specific feed tab, show each article individually.
      const allCrossFeed = related.length > 0 && related.every((a) => a.feed !== article.feed);
      if (allCrossFeed && isFiltered) {
        result.push(article);
      } else {
        for (const r of related) seen.add(r.slug);
        result.push({ ...article, relatedArticles: related.length > 0 ? related : undefined });
      }
    } else {
      result.push(article);
    }
  }

  return result;
}

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
